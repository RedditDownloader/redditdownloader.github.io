var CORS_PROXY_URL = "https://cors-anywhere.herokuapp.com/";
var CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;

/* User options */
var userDownload;
var targetName;
var section;
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
    $(".ui.form").form({
        fields: {
            targetNameInput : "empty",
            imageAmountInput : "integer[0..]"
        }
    });

    $("#restrictByScoreInput").checkbox({
        onChange: function() {
            if (this.checked) {
                $("#restrictByScoreTypeInput").parent().removeClass("disabled");
            } else {
                $("#restrictByScoreTypeInput").parent().addClass("disabled");
            }
            $("#restrictByScoreValueInput").prop("disabled", !this.checked);
        }
    });

    $("#userDownloadInput").checkbox({
        onChange: function() {
            if (this.checked) {
                $("label[for=targetNameInput]").text("User Name");
                $("#sectionInput").parent().parent().fadeOut("fast");
                $("#targetNameInput").removeAttr("placeholder");
            } else {
                $("label[for=targetNameInput]").text("Subreddit Name");
                $("#sectionInput").parent().parent().fadeIn("fast");
                setRandomNamePlaceholder();
            }
        }
    });
});

$("#downloadButton").click(function() {
    if ($(".ui.form").form("validate form")) {
        /* Reset states */
        $(".ui.form").addClass("loading");
        $("#unknownNameErrorBox").hide();
        $("#noImagesFoundWarningBox").hide();
        $("#downloadingInfoBox").show();
        downloadRequests.clear();
        downloadedCount = 0;
        toDownloadCount = 0;
        zip = new JSZip();
        updateUI();

        /* Read user options */
        userDownload = $("#userDownloadInput").checkbox("is checked");
        targetName = $("#targetNameInput").val();
        section = $("#sectionInput").val();
        nameFormat = $("#nameFormatInput").val();
        restrictByScore = $("#restrictByScoreInput").checkbox("is checked");
        restrictByScoreType = $("#restrictByScoreTypeInput").val();
        restrictByScoreValue = $("#restrictByScoreValueInput").val();
        includeImages = $("#includeImagesInput").checkbox("is checked");
        includeGifs = $("#includeGifsInput").checkbox("is checked");
        includeNsfw = $("#includeNsfwInput").checkbox("is checked");

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

        if (userDownload) {
            $(".downloadTypeText").text("user");
        } else {
            $(".downloadTypeText").text("subreddit");
        }

        if (!includeImages && !includeGifs) {
            $("#includeImagesInput").checkbox("check");
            includeImages = true;
        }

        /* Find images to scrape and start downloading */
        var maxImageCount = $("#imageAmountInput").val();
        download(maxImageCount);
    }
});

function updateUI() {
    $("#downloadedCountText").text(downloadedCount);
    $("#toDownloadCountText").text(toDownloadCount);
}

function download(maxImageCount, anchor) {
    /* Max 100 posts per request */
    var maxImageCountNow = Math.min(maxImageCount, 100);

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
                $(".targetNameText").text(targetName);
                doneDownloading();
                return;
            }

            var children = result.data.children;

            var downloadedCountNow = 0;

            for (var i = 0; i < children.length; i++) {
                var post = children[i].data;

                /* Only download if there's a thumbnail */
                if (post.thumbnail_width === null) {
                    continue;
                }

                /* Respect user's nsfw option */
                if (!includeNsfw && post.over_18) {
                    continue;
                }

                /* Check if there are any images, there should be, but let's make sure */
                if (post.preview === undefined || post.preview.images.length == 0) {
                    continue;
                }

                /* Don't download images that come from posts with greater/less score than inputted */
                if (restrictByScore) {
                    if ((restrictByScoreType === "ge" && post.score < restrictByScoreValue)
                            || (restrictByScoreType === "le" && post.score > restrictByScoreValue)) {
                        continue;
                    } 
                }

                var url = post.preview.images[0].source.url;

                if (isUrlFileFormatAccepted(url)) {
                    /* Force https */
                    if (url.startsWith("http:")) {
                        url = url.replace("http:", "https:");
                    }

                    toDownloadCount++;
                    downloadedCountNow++;
                    updateUI();

                    downloadImageAsBase64(url, post, function(url, post, data) {
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
                    });

                    if (downloadedCountNow == maxImageCount) {
                        break;
                    }
                }
            }

            maxImageCount -= downloadedCountNow;

            if (children.length === 0 || maxImageCount === 0) {
                checkFinishedInterval = setInterval(function() {
                    if (downloadedCount == toDownloadCount) {
                        doneDownloading();
                    }
                }, CHECK_DOWNLOADS_FINISHED_EVERY_MS);
            } else {
                if (result.data.after !== null) {
                    download(maxImageCount, result.data.after);
                } else {
                    /* If there are no more posts, quit */
                    doneDownloading();
                }
            }
        },
        error: function(error) {
            if (error.status === 404 || error.status === 403) {
                /* If HTTP status is 404 or 403, the subreddit probably doesn't exist */
                $("#unknownNameErrorBox").show();
                $(".targetNameText").text(targetName);
            } else if (error.status !== 200) {
                /* Notify user when a non-handled status code is received */
                alert("Unknown status code " + error.status + " received from lookup request.\nPlease contact the developer.");
            }
            doneDownloading();
        }
    });
}

function isUrlFileFormatAccepted(url) {
    return (includeImages && (url.indexOf(".jpg?") !== -1 || url.indexOf(".png?") !== -1))
        || (includeGifs && (url.indexOf(".gif?") !== -1 || url.indexOf(".gifv?") !== -1));
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
            $(".targetNameText").text(targetName);
        }
    }

    $(".ui.form").removeClass("loading");
    $("#downloadingInfoBox").hide();
}

function downloadImageAsBase64(url, post, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
        downloadRequests.delete(this);

        var reader = new FileReader();
        reader.onloadend = function() {
            callback(url, post, reader.result.split(",").pop());
        }
        reader.readAsDataURL(xhr.response);
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
