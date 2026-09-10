```javascript
import * as pdfjsLib from
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";


// =====================================================
// RAILWAY BACKEND
// =====================================================

const API_BASE =
    "https://ai-study-assistant-production-ce2c.up.railway.app";


// =====================================================
// PDF.JS WORKER
// =====================================================

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";


// =====================================================
// HTML ELEMENTS
// =====================================================

const documentInput =
    document.getElementById("document");

const uploadButton =
    document.getElementById("uploadButton");

const uploadStatus =
    document.getElementById("uploadStatus");

const questionInput =
    document.getElementById("question");

const askButton =
    document.getElementById("askButton");

const responseBox =
    document.getElementById("response");


// =====================================================
// CURRENT DOCUMENT
// =====================================================

let currentDocumentId = null;


// =====================================================
// BACKEND CONNECTION CHECK
// =====================================================

async function checkBackend() {

    try {

        const response =
            await fetch(API_BASE);

        if (!response.ok) {
            throw new Error("Backend unavailable");
        }

        uploadStatus.textContent =
            "Backend connected.";

    } catch (error) {

        console.error(
            "Backend connection error:",
            error
        );

        uploadStatus.textContent =
            "Backend connection failed.";

    }

}


// =====================================================
// LOAD LATEST DOCUMENT
// =====================================================

async function loadLatestDocument() {

    try {

        const response =
            await fetch(
                `${API_BASE}/api/documents/latest`
            );

        if (!response.ok) {
            return;
        }

        const data =
            await response.json();

        if (data && data.id) {

            currentDocumentId =
                data.id;

            uploadStatus.textContent =
                `Latest document: ${data.file_name}`;

        }

    } catch (error) {

        console.log(
            "No latest document loaded."
        );

    }

}


// =====================================================
// UPLOAD PDF
// =====================================================

uploadButton.addEventListener(
    "click",
    async () => {

        const file =
            documentInput.files[0];

        if (!file) {

            uploadStatus.textContent =
                "Please select a PDF first.";

            return;
        }


        if (
            file.type !== "application/pdf" &&
            !file.name.toLowerCase().endsWith(".pdf")
        ) {

            uploadStatus.textContent =
                "Please select a PDF file.";

            return;
        }


        uploadButton.disabled = true;

        uploadStatus.textContent =
            "Uploading PDF...";

        responseBox.textContent =
            "Please wait...";


        try {

            const formData =
                new FormData();

            formData.append(
                "document",
                file
            );


            const response =
                await fetch(
                    `${API_BASE}/api/documents/upload`,
                    {
                        method: "POST",
                        body: formData
                    }
                );


            // =================================================
            // NORMAL TEXT PDF
            // =================================================

            if (response.ok) {

                const data =
                    await response.json();

                if (!data.success) {

                    throw new Error(
                        data.message ||
                        "PDF upload failed."
                    );

                }


                currentDocumentId =
                    data.documentId;


                uploadStatus.textContent =
                    `PDF uploaded successfully. ` +
                    `Questions found: ${data.questionsFound || 0}`;


                responseBox.textContent =
                    "PDF is ready. Ask a question.";


                return;
            }


            // =================================================
            // SCANNED / IMAGE PDF
            //
            // Backend returns HTTP 400 when it cannot extract
            // enough text. We then use browser OCR.
            // =================================================

            if (response.status === 400) {

                let errorData = {};

                try {

                    errorData =
                        await response.json();

                } catch (error) {

                    console.log(
                        "Could not read backend error JSON."
                    );

                }


                const message =
                    errorData.message || "";


                if (
                    message.toLowerCase().includes(
                        "scanned"
                    ) ||
                    message.toLowerCase().includes(
                        "image-only"
                    ) ||
                    message.toLowerCase().includes(
                        "extract enough text"
                    )
                ) {

                    uploadStatus.textContent =
                        "Scanned PDF detected. Starting OCR...";


                    await processScannedPDF(file);


                    return;
                }


                throw new Error(
                    message ||
                    "PDF upload failed."
                );
            }


            // =================================================
            // OTHER SERVER ERROR
            // =================================================

            let errorData = {};

            try {

                errorData =
                    await response.json();

            } catch (error) {

                console.log(
                    "Server did not return JSON."
                );

            }


            throw new Error(
                errorData.message ||
                `Upload failed. Server returned ${response.status}.`
            );


        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );


            uploadStatus.textContent =
                `Upload failed: ${error.message}`;


            responseBox.textContent =
                "Please try another PDF.";


        } finally {

            uploadButton.disabled = false;

        }

    }
);


// =====================================================
// SCANNED PDF OCR
// =====================================================

async function processScannedPDF(file) {

    let worker = null;


    try {

        uploadStatus.textContent =
            "Reading PDF pages...";


        const arrayBuffer =
            await file.arrayBuffer();


        const pdf =
            await pdfjsLib.getDocument(
                {
                    data: arrayBuffer
                }
            ).promise;


        const totalPages =
            pdf.numPages;


        console.log(
            "PDF pages:",
            totalPages
        );


        let completeText = "";


        // =================================================
        // PROCESS ONE PAGE AT A TIME
        // =================================================

        worker =
            await Tesseract.createWorker(
                "eng"
            );


        for (
            let pageNumber = 1;
            pageNumber <= totalPages;
            pageNumber++
        ) {

            uploadStatus.textContent =
                `OCR processing page ${pageNumber} of ${totalPages}...`;


            console.log(
                `OCR page ${pageNumber}/${totalPages}`
            );


            const page =
                await pdf.getPage(
                    pageNumber
                );


            const viewport =
                page.getViewport(
                    {
                        scale: 1.5
                    }
                );


            const canvas =
                document.createElement(
                    "canvas"
                );


            const context =
                canvas.getContext(
                    "2d"
                );


            canvas.width =
                viewport.width;

            canvas.height =
                viewport.height;


            await page.render(
                {
                    canvasContext:
                        context,

                    viewport:
                        viewport
                }
            ).promise;


            const result =
                await worker.recognize(
                    canvas
                );


            const pageText =
                result.data.text || "";


            completeText +=
                `\n\n--- PAGE ${pageNumber} ---\n\n` +
                pageText;


            // Release canvas memory
            canvas.width = 1;
            canvas.height = 1;


            console.log(
                `Page ${pageNumber} OCR characters:`,
                pageText.length
            );

        }


        // =================================================
        // TERMINATE OCR WORKER
        // =================================================

        await worker.terminate();

        worker = null;


        completeText =
            completeText.trim();


        console.log(
            "Total OCR characters:",
            completeText.length
        );


        if (
            completeText.length < 20
        ) {

            throw new Error(
                "OCR could not read enough text from this PDF."
            );

        }


        // =================================================
        // SAVE OCR TEXT TO BACKEND
        // =================================================

        uploadStatus.textContent =
            "OCR completed. Saving document...";


        const saveResponse =
            await fetch(
                `${API_BASE}/api/documents/text`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify(
                        {
                            fileName:
                                file.name,

                            text:
                                completeText
                        }
                    )
                }
            );


        if (!saveResponse.ok) {

            let saveError = {};

            try {

                saveError =
                    await saveResponse.json();

            } catch (error) {

                console.log(
                    "Could not read OCR save error."
                );

            }


            throw new Error(
                saveError.message ||
                `OCR save failed (${saveResponse.status}).`
            );

        }


        const saveData =
            await saveResponse.json();


        if (!saveData.success) {

            throw new Error(
                saveData.message ||
                "Could not save OCR document."
            );

        }


        currentDocumentId =
            saveData.documentId;


        uploadStatus.textContent =
            `Scanned PDF processed successfully. ` +
            `Characters: ${completeText.length}`;


        responseBox.textContent =
            "PDF is ready. Ask a question.";


    } catch (error) {

        console.error(
            "OCR ERROR:",
            error
        );


        if (worker) {

            try {

                await worker.terminate();

            } catch (terminateError) {

                console.log(
                    "OCR worker termination error."
                );

            }

        }


        throw error;

    }

}


// =====================================================
// ASK QUESTION
// =====================================================

askButton.addEventListener(
    "click",
    async () => {

        const question =
            questionInput.value.trim();


        if (!question) {

            responseBox.textContent =
                "Please enter a question.";

            return;
        }


        if (!currentDocumentId) {

            // Try to find latest document
            await loadLatestDocument();

        }


        if (!currentDocumentId) {

            responseBox.textContent =
                "Please upload a PDF first.";

            return;
        }


        askButton.disabled = true;

        responseBox.textContent =
            "Searching your document...";


        try {

            const url =
                `${API_BASE}/api/documents/search` +
                `?documentId=${encodeURIComponent(
                    currentDocumentId
                )}` +
                `&q=${encodeURIComponent(
                    question
                )}`;


            const response =
                await fetch(url);


            let data = {};


            try {

                data =
                    await response.json();

            } catch (error) {

                throw new Error(
                    "Invalid response from server."
                );

            }


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    "Could not find an answer."
                );

            }


            if (!data.success) {

                throw new Error(
                    data.message ||
                    "No answer found."
                );

            }


            // =================================================
            // SHOW ANSWER
            // =================================================

            responseBox.textContent =
                data.answer ||
                "No answer found.";


            console.log(
                "Matched question:",
                data.matchedQuestion
            );


            console.log(
                "Search score:",
                data.score
            );


        } catch (error) {

            console.error(
                "QUESTION ERROR:",
                error
            );


            responseBox.textContent =
                error.message ||
                "Could not get an answer.";

        } finally {

            askButton.disabled = false;

        }

    }
);


// =====================================================
// PRESS ENTER TO ASK
// =====================================================

questionInput.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Enter"
        ) {

            askButton.click();

        }

    }
);


// =====================================================
// START APPLICATION
// =====================================================

async function startApp() {

    await checkBackend();

    await loadLatestDocument();

}


startApp();
