var CORS_PROXY_URL = "https://cors-anywhere.herokuapp.com/";
var CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;

/* User options */
var subName;
var includeNsfw;
var includeGifs;

var checkFinishedInterval;
var downloadRequests = new Set();
var downloadedCount;
var toDownloadCount;

var zip = new JSZip();

$(document).ready(function() {
    $('.ui.checkbox').checkbox();

    $('.ui.form').form({
        fields: {
            subNameInput : 'empty',
            maxImageCountInput : 'integer[0..]'
        }
    });
});

$("#downloadButton").click(function() {
    if ($('.ui.form').form('validate form')) {
        /* Reset states */
        $('.ui.form').addClass("loading");
        $("#unknownSubredditErrorBox").hide();
        $("#downloadingInfoBox").show();
        downloadRequests.clear();
        downloadedCount = 0;
        toDownloadCount = 0;
        updateUI();

        /* Read user options */
        subName = $("#subNameInput").val();
        includeNsfw = $("#includeNsfwInput").is(':checked');
        includeGifs = $("#includeGifsInput").is(':checked');

        /* Find images to scrape and start downloading */
        var maxImageCount = $("#maxImageCountInput").val();
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

    $.ajax({
        url: CORS_PROXY_URL 
            + "https://www.reddit.com/r/" + subName 
            + "/hot.json?limit=" + maxImageCountNow 
            + (anchor !== undefined ? "&after=" + anchor : ""),
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: function(result, status, xhr) {
            /* Check if we have been redirect to the search page = subreddit doesn't exist */
            if (xhr.getResponseHeader("X-Final-Url").indexOf("hot.json") !== -1) {
                var children = result.data.children;

                if (children.length > 0) {
                    for (var i = 0; i < children.length; i++) {
                        var post = children[i].data;

                        if (includeNsfw || !post.over_18) {
                            if (post.preview !== undefined && post.preview.images.length > 0) {
                                var url = post.preview.images[0].source.url;

                                if (isUrlFileFormatAccepted(url)) {
                                    /* Force https */
                                    if (url.startsWith("http:")) {
                                        url = url.replace("http:", "https:");
                                    }

                                    toDownloadCount++;
                                    updateUI();

                                    downloadImageAsBase64(url, function(url, data) {
                                        zip.file(url.replace(/(.+\/)/, "").replace(/(\?.+)/, ""), data, { base64: true });
                                        downloadedCount++;
                                        updateUI();
                                    });
                                }
                            }
                        }
                    }
                }

                maxImageCount -= maxImageCountNow;

                if (children.length === 0 || maxImageCount === 0) {
                    checkFinishedInterval = setInterval(function() {
                        if (downloadedCount == toDownloadCount) {
                            doneDownloading();
                        }
                    }, CHECK_DOWNLOADS_FINISHED_EVERY_MS);
                } else {
                    download(maxImageCount, result.data.after);
                }
            } else {
                $("#unknownSubredditErrorBox").show();
                $("#subNameText").text(subName);
                doneDownloading();
            }
        },
        error: function(error) {
            if (error.status === 404 || error.status === 403) {
                /* If HTTP status is 404 or 403, the subreddit probably doesn't exist */
                $("#unknownSubredditErrorBox").show();
                $("#subNameText").text(subName);
            } else if (error.status !== 200) {
                /* Notify user when a non-handled status code is received */
                alert("Unknown status code " + error.status + " received from lookup request.\nPlease contact the developer.");
            }
            doneDownloading();
        }
    });
}

function isUrlFileFormatAccepted(url) {
    return url.indexOf(".jpg?") !== -1 
        || url.indexOf(".png?") !== -1
        || (includeGifs && (url.indexOf(".gif?") !== -1 || url.indexOf(".gifv?") !== -1));
}

function doneDownloading() {
    for (var xhr in downloadRequests) {
        xhr.abort();
    }

    clearInterval(checkFinishedInterval);

    if (downloadedCount > 0) {
        zip.generateAsync({ type:"blob" })
            .then(function(content) {
                saveAs(content, "r-" + subName + "-images.zip");
            });
    }

    $('.ui.form').removeClass("loading");
    $("#downloadingInfoBox").hide();
}

function downloadImageAsBase64(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
        downloadRequests.delete(this);

        var reader = new FileReader();
        reader.onloadend = function() {
            callback(url, reader.result.split(',').pop());
        }
        reader.readAsDataURL(xhr.response);
    };
    xhr.open('GET', CORS_PROXY_URL + url);
    xhr.responseType = 'blob';
    xhr.send();

    downloadRequests.add(xhr);
}

// https://stackoverflow.com/a/30949767/4313694
$('button').on('mousedown', 
    function(event) {
        event.preventDefault();
    }
);
