var CORS_PROXY_URL = "https://cors-anywhere.herokuapp.com/";
var CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;

var checkFinishedInterval;
var downloadRequests = new Set();
var downloadedCount;
var toDownloadCount;
var subName;

var zip = new JSZip();

$("#downloadButton").click(function() {
    if (inputIsValid()) {
        /* Reset states */
        downloadRequests.clear();
        downloadedCount = 0;
        toDownloadCount = 0;
        subName = $("#subNameInput").val();
        updateCancelButton();

        /* Hide the download button */
        $("#downloadButton").hide();
        $("#cancelButton").show();

        /* Find images to scrape and start downloading */
        var maxImageCount = $("#maxImageCountInput").val();
        download(maxImageCount);
    }
});

function inputIsValid() {
    if ($("#maxImageCountInput").val() < 1) {
        addIncorrectInput($("#maxImageCountInput"));
        return false;
    }

    return true;
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
        success: function(result) {
            var children = result.data.children;

            if (children.length > 0) {
                for (var i = 0; i < children.length; i++) {
                    var post = children[i].data;

                    if (post.preview !== undefined && post.preview.images.length > 0) {
                        var url = post.preview.images[0].source.url;

                        if (url.indexOf(".jpg?") !== -1) {
                            if (url.startsWith("http:")) {
                                url = url.replace("http:", "https:");
                            }

                            toDownloadCount++;

                            downloadImageAsBase64(url, function(url, data) {
                                zip.file(url.replace(/(.+\/)/, "").replace(/(\?.+)/, ""), data, { base64: true });
                                downloadedCount++;
                                updateCancelButton();
                            });
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
        },
        error: function(error) {
            if (error.status === 404 || error.status === 403) {
                /* If HTTP status is 404 or 403, the subreddit probably doesn't exist */
                addIncorrectInput($("#subNameInput"));
            } else if (error.status !== 200) {
                /* Notify user when a non-handled status code is received */
                alert("Unknown status code " + error.status + " received from lookup request.\nPlease contact the developer.");
            }
            doneDownloading();
        }
    });
}

function updateCancelButton() {
    $("#cancelButton").val("downloaded " + downloadedCount + " image" + (downloadedCount == 1 ? "" : "s") + ".. press to cancel");
}

function doneDownloading() {
    clearInterval(checkFinishedInterval);

    if (downloadedCount > 0) {
        zip.generateAsync({ type:"blob" })
            .then(function(content) {
                saveAs(content, "r-" + subName + "-images.zip");
            });
    }

    $("#cancelButton").hide();
    $("#downloadButton").show();
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

$("#cancelButton").click(function() {
    for (var xhr in downloadRequests) {
        xhr.abort();
    }
    doneDownloading();
});

function addIncorrectInput(item) {
    $(item).addClass("incorrect-input");
    $(item).focus();

    var removeIncorrectInput = function() {
        $(item).removeClass("incorrect-input");
    };
    $(item).keypress(removeIncorrectInput);
    $(item).mousedown(removeIncorrectInput);
}
