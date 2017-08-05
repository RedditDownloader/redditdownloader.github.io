var CORS_PROXY_URL = "https://cors-anywhere.herokuapp.com/";

var downloadInterval;
var downloadRequests;
var downloadedCount;
var toDownloadCount;
var subName;

var zip = new JSZip();

$("#downloadButton").click(function() {
    downloadRequests = new Set();
    downloadedCount = 0;
    toDownloadCount = 0;
    subName = $("#subNameInput").val();

    updateCancelButton();

    $(this).hide();
    $("#cancelButton").show();

    $.ajax({
        url: CORS_PROXY_URL + "https://www.reddit.com/r/" + subName + "/hot.json",
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: function(result) {
            var children = result.data.children;

            if (children.length > 0) {
                for (var i = 0; i < Math.min(children.length, $("#maxImageCountInput").val()); i++) {
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

                downloadInterval = setInterval(function() {
                    if (downloadedCount == toDownloadCount) {
                        doneDownloading();
                    }
                }, 250);
            }
        },
        error: function(error) {
            if (error.status != 200) {
                $("#subNameInput").addClass("incorrect-input");
            }
            doneDownloading();
        }
    });
});

$("#subNameInput").keypress(function() {
    $("#subNameInput").removeClass("incorrect-input");
});
$("#subNameInput").mousedown(function() {
    $("#subNameInput").removeClass("incorrect-input");
});

$("#cancelButton").click(function() {
    for (var xhr in downloadRequests) {
        xhr.abort();
    }
    doneDownloading();
});

function updateCancelButton() {
    $("#cancelButton").val("downloaded " + downloadedCount + " image" + (downloadedCount == 1 ? "" : "s") + ".. press to cancel");
}

function doneDownloading() {
    clearInterval(downloadInterval);

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
            callback(url, reader.result.replace(/^data:.+\/(.+);base64,/, ""));
        }
        reader.readAsDataURL(xhr.response);
    };
    xhr.open('GET', CORS_PROXY_URL + url);
    xhr.responseType = 'blob';
    xhr.send();

    downloadRequests.add(xhr);
}
