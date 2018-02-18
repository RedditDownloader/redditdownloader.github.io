var CORS_PROXY_URL = "https://cors-anywhere.herokuapp.com/";
var CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;

/* User options */
var userDownload;
var targetName;
var section;
var maxImageCount;
var nameFormat;
var restrictByScore;
var restrictByScoreType;
var restrictByScoreValue;
var includeImages;
var includeGifs;
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

    /* Make sure one or both of include images and include animated images are checked */
    $.fn.form.settings.rules.includeAny = function(value) {
        return $("#includeImagesInput").parent().checkbox("is checked")
            || $("#includeGifsInput").parent().checkbox("is checked");
    };

    $(".ui.form")
        .form({
            fields: {
                targetNameInput : "empty",
                imageAmountInput : "integer[0..]",
                restrictByScoreValueInput : "integer[0..]",
                includeImagesInput : "includeAny",
                includeGifsInput : "includeAny"
            }
        })
        .on("change", "#includeImagesInput,#includeGifsInput", function(e) {
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
                $("#sectionInput").parent().addClass("disabled");
                $("#targetNameInput").attr("placeholder", "uniquepassive");
            } else {
                $("label[for=targetNameInput]").text("Subreddit Name");
                $("#sectionInput").parent().removeClass("disabled");
                setRandomNamePlaceholder();
            }
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
        nameFormat = $("#nameFormatInput").val();
        restrictByScore = $("#restrictByScoreInput").parent().checkbox("is checked");
        restrictByScoreType = $("#restrictByScoreTypeInput").val();
        restrictByScoreValue = $("#restrictByScoreValueInput").val();
        includeImages = $("#includeImagesInput").parent().checkbox("is checked");
        includeGifs = $("#includeGifsInput").parent().checkbox("is checked");
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

        /* Find images to scrape and start downloading */
        maxImageCount = $("#imageAmountInput").val();
        download();
    }
});

function updateUI() {
    $("#downloadedCountText").text(downloadedCount);
    $("#toDownloadCountText").text(toDownloadCount);
}

function download(anchor) {
    /* Max 100 posts per request */
    var maxImageCountNow = Math.min(maxImageCount - toDownloadCount, 100);

    /* Prevent extreme amounts of requests in the case that maxImageCountNow is for example 1 */
    if (maxImageCountNow < 50) {
        maxImageCountNow = 50;
    }

    var url;

    if (userDownload) {
        url = CORS_PROXY_URL
            + "https://www.reddit.com/user/" + targetName
            + ".json?limit=" + maxImageCountNow
            + (anchor !== undefined ? "&after=" + anchor : "");
    } else {
        url = CORS_PROXY_URL 
            + "https://www.reddit.com/r/" + targetName 
            + "/" + section + ".json?limit=" + maxImageCountNow 
            + (anchor !== undefined ? "&after=" + anchor : "");
    }

    $.ajax({
        url: url,
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: function(result, status, xhr) {
            /* Make sure we haven't been redirected to the search page = subreddit doesn't exist */
            if (!userDownload && xhr.getResponseHeader("X-Final-Url").indexOf(section + ".json") === -1) {
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
                if (!includeGifs && (url.indexOf(".gif") !== -1 || url.indexOf(".gifv") !== -1)) {
                    continue;
                }

                /* Continue if direct url is an image and user doesn't want to download images */
                if (!includeImages && (url.indexOf(".jpg") !== -1 || url.indexOf(".png") !== -1)) {
                    continue;
                }

                if (isUrlDirect(url)) {
                    /* Handle item with extension (direct link) */
                    toDownloadCount++;
                    downloadUrl(url, post);
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

                                toDownloadCount++;

                                var url = images[i].link;
                                downloadUrl(url, this.post);
                            }
                        },
                        error: function(error) {
                            if (!error.responseJSON.data.error.startsWith("Unable to find")) {
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
                            downloadUrl(url, this.post);
                        },
                        error: function(error) {
                            if (!error.responseJSON.data.error.startsWith("Unable to find")) {
                                doneDownloading();
                                alert("Accessing the Imgur API failed!\nPlease contact the developer.\nResponse code: " 
                                    + error.status + "\nResponse: " + error.responseText);
                            }
                            toDownloadCount--;
                        }
                    });
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
            } else if (error.status !== 200) {
                /* Notify user when a non-handled status code is received */
                alert("Unknown status code " + error.status + " received from lookup request.\nPlease contact the developer.");
            }
            doneDownloading();
        }
    });
}

function downloadUrl(url, post) {
    downloadImageAsBase64(url, post, 
        function(url, post, data) {
            var destinationFileName;

            if (nameFormat === "file-name") {
                destinationFileName = getFileNameWithExtension(url);
            } else if (nameFormat === "post-id") {
                destinationFileName = post.name + getFileExtension(url);
            } else {
                /* default: post-name */
                var regex = /[^\/]+(?=\/$|$)/g;
                var postName = regex.exec(post.permalink)[0];
                destinationFileName = postName + getFileExtension(url);
            }

            zip.file(destinationFileName, data, { base64: true });
            downloadedCount++;
            updateUI();
        },
        function() {
            toDownloadCount--;
        }
    );
}

function isUrlDirect(url) {
    return url.indexOf(".jpg") !== -1 || url.indexOf(".png") !== -1 
        || url.indexOf(".gif") !== -1 || url.indexOf(".gifv") !== -1;
}

function getFileNameWithExtension(url) {
    var regex = /[^/\\&\?]+\.\w{3,4}(?=[\?&].*$|$)/;
    var m = regex.exec(url);
    return m[0];
}

function getFileExtension(url) {
    var fileNameWithExt = getFileNameWithExtension(url);

    return fileNameWithExt
        .substring(fileNameWithExt.lastIndexOf("."));
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

function downloadImageAsBase64(url, post, callback, errored) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
        downloadRequests.delete(this);

        var reader = new FileReader();
        reader.onloadend = function() {
            callback(url, post, reader.result.split(",").pop());
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
