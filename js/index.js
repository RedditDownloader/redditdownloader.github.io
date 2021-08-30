var CORS_PROXY_URL = "https://cors.bridged.cc/";
var CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;
var MAX_POSTS_PER_REQUEST = 100;
var MIN_POSTS_PER_REQUEST = 5;
var RETRY_POSTS_FACTOR = 0.7;

/* User options */
var userDownload;
var targetName;
var section;
var maxImageCount;
var maxPostsPerRequest;
var nameFormat;
var restrictByScore;
var restrictByScoreType;
var restrictByScoreValue;
var includeImages;
var includeGifs;
var includeVideos;
var includeOthers;
var includeAsLink;
var includeNsfw;

var checkFinishedInterval;
var downloadRequests = new Set();
var downloadedCount;
var toDownloadCount;
var zip;

$(document).ready(function() {
    setRandomNamePlaceholder();

    $(".ui.checkbox").checkbox();
    $("select.dropdown").dropdown();

    /* Make sure one or more of include images, animated images, videos or others are checked */
    $.fn.form.settings.rules.includeAny = function(value) {
        return $("#includeImagesInput").parent().checkbox("is checked")
            || $("#includeGifsInput").parent().checkbox("is checked")
            || $("#includeVideosInput").parent().checkbox("is checked")
            || $("#includeOthersInput").parent().checkbox("is checked");
    };

    $(".ui.form")
        .form({
            fields: {
                targetNameInput : "empty",
                imageAmountInput : "integer[0..]",
                restrictByScoreValueInput : "integer[0..]",
                includeImagesInput : "includeAny",
                includeGifsInput : "includeAny",
                includeVideosInput : "includeAny",
                includeOthersInput : "includeAny"
            }
        })
        .on("change", "#includeImagesInput,#includeGifsInput,#includeVideosInput,#includeOthersInput", function(e) {
            /* 
                Removes the red text from include images/include 
                animated images when one of them have been pressed.
            */
            $(".ui.form").form("validate form");
        });

    $("#restrictByScoreInput").parent().checkbox({
        onChange: function() {
            if (this.checked) {
                $("#restrictByScoreTypeInput").parent().removeClass("disabled");
            } else {
                $("#restrictByScoreTypeInput").parent().addClass("disabled");
            }
            $("#restrictByScoreValueInput").prop("disabled", !this.checked);
        }
    });

    $("#userDownloadInput").parent().checkbox({
        onChange: function() {
            if (this.checked) {
                $("label[for=targetNameInput]").text("User Name");
                $("#targetNameInput").attr("placeholder", "username");
                $("#sectionInput").parent().addClass("disabled");
                $("#searchFilterInput").prop("disabled", true);
            } else {
                $("label[for=targetNameInput]").text("Subreddit Name");
                $("#sectionInput").parent().removeClass("disabled");
                $("#searchFilterInput").prop("disabled", false);
                setRandomNamePlaceholder();
            }
            $("#targetNameInput").focus();
            $("#targetNameInput").select();
        }
    });
});

$("#downloadButton").click(function() {
    $("#unknownNameErrorBox").hide();
    $("#noImagesFoundWarningBox").hide();

    if ($(".ui.form").form("validate form")) {
        /* Reset states */
        $(".ui.form").addClass("loading");
        $("#downloadingInfoBox").show();
        downloadRequests.clear();
        downloadedCount = 0;
        toDownloadCount = 0;
        zip = new JSZip();
        updateUI();

        /* Read user options */
        userDownload = $("#userDownloadInput").parent().checkbox("is checked");
        targetName = $("#targetNameInput").val();
        section = $("#sectionInput").val();
        sectionTimespan = ""; // Set further down if section contains a timespan (eg. section is "top-week")
        searchFilter = $("#searchFilterInput").val();
        nameFormat = $("#nameFormatInput").val();
        restrictByScore = $("#restrictByScoreInput").parent().checkbox("is checked");
        restrictByScoreType = $("#restrictByScoreTypeInput").val();
        restrictByScoreValue = $("#restrictByScoreValueInput").val();
        includeImages = $("#includeImagesInput").parent().checkbox("is checked");
        includeGifs = $("#includeGifsInput").parent().checkbox("is checked");
        includeVideos = $("#includeVideosInput").parent().checkbox("is checked");
        includeOthers = $("#includeOthersInput").parent().checkbox("is checked");
        includeAsLink = $("#includeAsLinkInput").parent().checkbox("is checked");
        includeNsfw = $("#includeNsfwInput").parent().checkbox("is checked");

        if (userDownload) {
            /* Handle the user entering /user/ or user/ before the user name */
            if (targetName.startsWith("/user/")) {
                targetName = targetName.substring(3);
            } else if (targetName.startsWith("user/")) {
                targetName = targetName.substring(2);
            }
        } else {
            /* Handle the user entering /r/ or r/ before the sub name */
            if (targetName.startsWith("/r/")) {
                targetName = targetName.substring(3);
            } else if (targetName.startsWith("r/")) {
                targetName = targetName.substring(2);
            }
        }

        $(".targetNameText").text(targetName);

        if (userDownload) {
            $(".downloadTypeText").text("user");
        } else {
            $(".downloadTypeText").text("subreddit");
        }
        
        if (section.includes("-")) {
            var split = section.split("-");
            section = split[0];
            sectionTimespan = split[1];
        }

        /* Find images to scrape and start downloading */
        maxImageCount = $("#imageAmountInput").val();
        maxPostsPerRequest = MAX_POSTS_PER_REQUEST;
        download();
    }
});

$("#cancelDownloadButton").click(function() {
    doneDownloading();
});

function updateUI() {
    $("#downloadedCountText").text(downloadedCount);
    $("#toDownloadCountText").text(toDownloadCount);
}

function download(anchor) {
    /* Max MAX_POSTS_PER_REQUEST posts per request */
    var maxImageCountNow = Math.min(maxImageCount - toDownloadCount, maxPostsPerRequest);

    /* Prevent extreme amounts of requests in the case that maxImageCountNow is for example 1 */
    if (maxImageCountNow < MIN_POSTS_PER_REQUEST) {
        maxImageCountNow = MIN_POSTS_PER_REQUEST;
    }

    var url;

    if (userDownload) {
        url = CORS_PROXY_URL
            + "https://www.reddit.com/user/" + targetName
            + ".json?limit=" + maxImageCountNow
            + (anchor !== undefined ? "&after=" + anchor : "");
    } else if (searchFilter) {
        url = CORS_PROXY_URL
            + "https://www.reddit.com/r/" + targetName
            + "/search.json?q=" + searchFilter + "&restrict_sr=on&limit=" + maxImageCountNow
            + (includeNsfw ? "&include_over_18=on" : "")
            + (anchor !== undefined ? "&after=" + anchor : "");
    } else {
        url = CORS_PROXY_URL
            + "https://www.reddit.com/r/" + targetName
            + "/" + section + ".json?limit=" + maxImageCountNow
            + (anchor !== undefined ? "&after=" + anchor : "");
    }
    if (sectionTimespan) {
        url += "&t=" + sectionTimespan;
    }

    $.ajax({
        url: url,
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: function(result, status, xhr) {
            /* Make sure we haven't been redirected to the search page = subreddit doesn't exist */
            if (!userDownload && !searchFilter && xhr.getResponseHeader("X-Final-Url").indexOf(section + ".json") === -1) {
                $("#unknownNameErrorBox").show();
                doneDownloading();
                return;
            }

            var children = result.data.children;

            for (var i = 0; i < children.length; i++) {
                if (toDownloadCount >= maxImageCount) { 
                    break; 
                }

                var post = children[i].data;
                var url = post.url;

                /* Only download if there's a URL */
                if (url == null) {
                    continue;
                }

                /* Respect user's nsfw option */
                if (!includeNsfw && post.over_18) {
                    continue;
                }

                /* Don't download images that come from posts with greater/less score than inputted */
                if (restrictByScore) {
                    if ((restrictByScoreType === "ge" && post.score < restrictByScoreValue)
                            || (restrictByScoreType === "le" && post.score > restrictByScoreValue)) {
                        continue;
                    } 
                }

                /* Continue if direct url is a gif and user doesn't want to download gifs */
                if (!includeGifs && isDirectGifUrl(url)) {
                    continue;
                }

                /* Continue if post links to a video and user doesn't want to download videos */
                if (!includeVideos && (post.is_video || isDirectVideoUrl(url))) {
                    continue;
                }

                /* Continue if direct url is an image and user doesn't want to download images */
                if (!includeImages && isDirectImageUrl(url)) {
                    continue;
                }

                /* Continue if link links to Imgur and we're not including anything that you can get from Imgur */
                if (!includeGifs && !includeVideos && !includeImages && (url.startsWith("http://imgur.com/") || url.startsWith("https://imgur.com/"))) {
                    continue;
                }

                if (isDirectImageUrl(url) || isDirectVideoUrl(url) || isDirectGifUrl(url)) {
                    /* Handle item with extension (direct link) */
                    toDownloadCount++;
                    downloadUrl(url, post);
                } else if (url.indexOf("v.redd.it/") !== -1) {
                    /* Handle Reddit video link */
                    if (!post.media || !post.media.reddit_video || !post.media.reddit_video.fallback_url) {
                        console.log("Error: v.redd.it post (" + url + ") did not have an associated media object");
                        continue;
                    }

                    var videoUrl = post.media.reddit_video.fallback_url;
                    // TODO: Add the audio track to the video
                    //var audioUrl = videoUrl.replace(/(\d)+\.mp4/, 'audio.mp4');

                    toDownloadCount++;
                    downloadUrl(videoUrl, post);
                } else if (url.startsWith("http://imgur.com/a/") || url.startsWith("https://imgur.com/a/")) {
                    /* Handle downloading an album */
                    var imageName = url.substring(url.lastIndexOf("/") + 1);

                    $.ajax({
                        url: "https://api.imgur.com/3/album/" + imageName,
                        type: "GET",
                        dataType: "json",
                        contentType: "application/json; charset=utf-8",
                        headers: {
                            "authorization": "Client-ID 326b1cb24da9d5e"
                        },
                        post: post, // pass to success function
                        success: function(result, status, xhr) {
                            var images = result.data.images;

                            for (var i = 0; i < images.length; i++) {
                                if (toDownloadCount >= maxImageCount) {
                                    break;
                                }

                                var url = result.data.link;
                                if (!includeGifs && isDirectGifUrl(url)
                                    || !includeVideos && isDirectVideoUrl(url)
                                    || !includeImages && isDirectImageUrl(url)) {
                                    continue;
                                }
                                if (!includeNsfw && result.data.nsfw) {
                                    continue;
                                }

                                toDownloadCount++;
                                downloadUrl(url, this.post);
                            }
                        },
                        error: function(error) {
                            if (error.status !== 404) {
                                doneDownloading();
                                alert("Accessing the Imgur API failed!\nPlease contact the developer.\nResponse code: " 
                                    + error.status + "\nResponse: " + error.responseText);
                            }
                            toDownloadCount--;
                        }
                    });
                } else if (url.startsWith("http://imgur.com/") || url.startsWith("https://imgur.com/")) {
                    /* Handle downloading a single-image album */
                    toDownloadCount++;

                    var imageName = url.substring(url.lastIndexOf("/") + 1);

                    $.ajax({
                        url: "https://api.imgur.com/3/image/" + imageName,
                        type: "GET",
                        dataType: "json",
                        contentType: "application/json; charset=utf-8",
                        headers: {
                            "authorization": "Client-ID 326b1cb24da9d5e"
                        },
                        post: post, // pass to success function
                        success: function(result, status, xhr) {
                            var url = result.data.link;
                            if (!includeGifs && isDirectGifUrl(url)
                                || !includeVideos && isDirectVideoUrl(url)
                                || !includeImages && isDirectImageUrl(url)) {
                                return;
                            }
                            if (!includeNsfw && result.data.nsfw) {
                                return;
                            }
                            downloadUrl(url, this.post);
                        },
                        error: function(error) {
                            if (error.status !== 404) {
                                doneDownloading();
                                alert("Accessing the Imgur API failed!\nPlease contact the developer.\nResponse code: " 
                                    + error.status + "\nResponse: " + error.responseText);
                            }
                            toDownloadCount--;
                        }
                    });
                } else if (includeOthers) {
                    /* Handle downloading direct files with non-image/video extensions */
                    try {
                        getFileExtension(url);
                    } catch (error) {
                        console.log("Info: '" + url + "' was not a direct URL, skipping download..");
                        continue;
                    }
                    toDownloadCount++;
                    downloadUrl(url, post);
                }
            }

            if (children.length === 0 || toDownloadCount >= maxImageCount || result.data.after === null) {
                var reasonWasMaxImageCount = toDownloadCount >= maxImageCount;

                checkFinishedInterval = setInterval(function() {
                    if (reasonWasMaxImageCount && toDownloadCount < maxImageCount) {
                        // this happens if an image has failed to download
                        // and we need to try to download more images
                        clearInterval(checkFinishedInterval);
                        download(result.data.after);
                    } else if (downloadedCount === toDownloadCount) {
                        doneDownloading();
                    }
                }, CHECK_DOWNLOADS_FINISHED_EVERY_MS);
            } else {
                download(result.data.after);
            }
        },
        error: function(error) {
            if (error.status === 404 || error.status === 403) {
                /* If HTTP status is 404 or 403, the subreddit probably doesn't exist */
                $("#unknownNameErrorBox").show();
                doneDownloading();
            } else if (error.status == 0) {
                /* The response body is likely too large for the CORS proxy, retry with fewer posts */
                maxPostsPerRequest = Math.ceil(maxPostsPerRequest * RETRY_POSTS_FACTOR);
                if (maxPostsPerRequest >= MIN_POSTS_PER_REQUEST) {
                    download(anchor);
                } else {
                    alert("Retried retrieval of Reddit posts too many times, are you connected to the Internet?");
                    doneDownloading();
                }
            } else if (error.status !== 200) {
                /* Notify user when a non-handled status code is received */
                alert("Unknown error " + JSON.stringify(error) + " received from lookup request.\nPlease contact the developer.");
                doneDownloading();
            }
        }
    });
}

function downloadUrl(url, post) {
    downloadFileAsBase64(url, 
        function(data) {
            var fileName = getFileNameForPost(url, post);
            var extension = getFileExtension(url);
            addFileToZip(fileName, extension, data, post.created_utc, true);
            downloadedCount++;
            updateUI();
        },
        function() {
            if (includeAsLink) {
                /* Windows URL format */
                var data = "[{000214A0-0000-0000-C000-000000000046}]\n" + 
                           "Prop3=19,11\n" + 
                           "[InternetShortcut]\n" +
                           "IDList=\n" +
                           "URL=" + url;
                var fileName = getFileNameForPost(url, post);
                addFileToZip(fileName, ".url", data, post.created_utc, false);
                downloadedCount++;
            } else {
                toDownloadCount--;
            }
        }
    );
}

function getFileNameForPost(url, post) {
    if (nameFormat === "file-name") {
        return getFileName(url);
    } else if (nameFormat === "post-id") {
        return post.name;
    } else {
        /* default: post-name */
        var regex = /[^\/]+(?=\/$|$)/g;
        return regex.exec(post.permalink)[0];
    }
}

function addFileToZip(fileName, extension, data, createdUtc, dataIsBase64) {
    /* post-id is the only file name guaranteed to be unique */
    if (nameFormat !== "post-id") {
        /* Make sure we don't overwrite a saved file */
        var oldFileName = fileName;
        var counter = 0;
        while (zip.file(oldFileName + extension)) {
            oldFileName = fileName + "_" + counter++;
        }
        fileName = oldFileName;
    }

    zip.file(fileName + extension, data, { 
        base64: dataIsBase64,
        date: new Date(createdUtc * 1000)
    });
}

function isDirectImageUrl(url) {
    url = url.toLowerCase();
    return url.indexOf(".jpg") !== -1 || url.indexOf(".jpeg") !== -1
        || url.indexOf(".png") !== -1 || url.indexOf(".bmp") !== -1
        || url.indexOf(".svg") !== -1 || url.indexOf(".webp") !== -1
        || url.indexOf(".raw") !== -1 || url.indexOf(".tiff") !== -1
        || url.indexOf(".ico") !== -1 || url.indexOf(".heif") !== -1;
}

function isDirectVideoUrl(url) {
    url = url.toLowerCase();
    return url.indexOf(".mp4") !== -1;
}

function isDirectGifUrl(url) {
    url = url.toLowerCase();
    return url.indexOf(".gif") !== -1 || url.indexOf(".gifv") !== -1;
}

function getFileNameWithExtension(url) {
    var regex = /[^/\\&\?]+\.\w{3,4}(?=[\?&].*$|$)/;
    var m = regex.exec(url);
    return m[0];
}

function getFileName(url) {
    var fileNameWithExt = getFileNameWithExtension(url);
    return fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf("."));
}

function getFileExtension(url) {
    var fileNameWithExt = getFileNameWithExtension(url);
    return fileNameWithExt.substring(fileNameWithExt.lastIndexOf("."));
}

function doneDownloading() {
    // only run the "done" code if we're downloading
    if (!$(".ui.form").hasClass("loading")) {
        return;
    }

    $(".ui.form").removeClass("loading");
    $("#downloadingInfoBox").hide();

    for (var xhr in downloadRequests) {
        xhr.abort();
    }

    clearInterval(checkFinishedInterval);

    if (downloadedCount > 0) {
        zip.generateAsync({ type:"blob" })
            .then(function(content) {
                saveAs(content, targetName + "_" + section + ".zip");
            });
    } else {
        /* Only show the "no images found" warning if the subreddit exists */
        if (!$("#unknownNameErrorBox").is(":visible")) {
            $("#noImagesFoundWarningBox").show();
        }
    }
}

function downloadFileAsBase64(url, callback, errored) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
        downloadRequests.delete(this);

        var reader = new FileReader();
        reader.onloadend = function() {
            callback(reader.result.split(",").pop());
        }
        reader.readAsDataURL(xhr.response);
    };
    xhr.onerror = function() {
        errored();
    };
    xhr.open("GET", CORS_PROXY_URL + url);
    xhr.responseType = "blob";
    xhr.send();

    downloadRequests.add(xhr);
}

/* 
    Puts a random subreddit as sub name inputbox placeholder,
    list taken from https://www.reddit.com/reddits 
*/
function setRandomNamePlaceholder() {
    var subreddits = [
        "funny",
        "pics",
        "me_irl",
        "aww",
        "dankmemes",
        "mildlyinteresting",
        "AdviceAnimals",
        "CrappyDesign",
        "OldSchoolCool",
        "2007scape"
    ];
    $("#targetNameInput").attr("placeholder", 
        subreddits[Math.floor(Math.random() * subreddits.length)]);
}

// https://stackoverflow.com/a/30949767/4313694
$("button").on("mousedown", 
    function(event) {
        event.preventDefault();
    }
);
