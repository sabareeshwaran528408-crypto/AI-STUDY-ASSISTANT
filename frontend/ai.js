// ==========================================
// AI STUDY ASSISTANT - FRONTEND
// ==========================================

import * as pdfjsLib from
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

// ==========================================
// RAILWAY BACKEND URL
// ==========================================

const API_BASE =
    "https://ai-study-assistant-production-ce2c.up.railway.app";

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

// ==========================================
// HTML ELEMENTS
// ==========================================

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

// ==========================================
// CURRENT DOCUMENT
// ==========================================

let currentDocumentId = null;

// ==========================================
// CHECK HTML ELEMENTS
// ==========================================

if (!documentInput) {
    console.error("ERROR: #document input not found.");
}

if (!uploadButton) {
    console.error("ERROR: #uploadButton not found.");
}

if (!uploadStatus) {
    console.error("ERROR: #uploadStatus not found.");
}

if (!questionInput) {
    console.error("ERROR: #question input not found.");
}

if (!askButton) {
    console.error("ERROR: #askButton not found.");
}

if (!responseBox) {
    console.error("ERROR: #response not found.");
}

// ==========================================
// CHECK BACKEND
// ==========================================

async function checkBackend() {

    try {

        uploadStatus.textContent =
            "Connecting to backend...";

        const response =
            await fetch(API_BASE, {
                method: "GET"
            });

        if (!response.ok) {
            throw new Error(
                `Backend returned ${response.status}`
            );
        }

        uploadStatus.textContent =
            "Backend connected. Select a PDF.";

        console.log(
            "Backend connected successfully."
        );

    } catch (error) {

        console.error(
            "BACKEND ERROR:",
            error
        );

        uploadStatus.textContent =
            "Backend connection failed.";

    }
}

// ==========================================
// LOAD LATEST DOCUMENT
// ==========================================

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

            console.log(
                "Latest document:",
                data
            );
        }

    } catch (error) {

        console.log(
            "No previous document available."
        );

    }
}

// ==========================================
// UPLOAD PDF
// ==========================================

uploadButton.addEventListener(
    "click",
    async function () {

        console.log(
            "Upload button clicked."
        );

        const file =
            documentInput.files[0];

        // ----------------------------------
        // CHECK FILE
        // ----------------------------------

        if (!file) {

            uploadStatus.textContent =
                "Please select a PDF first.";

            responseBox.textContent =
                "No PDF selected.";

            return;
        }

        console.log(
            "Selected file:",
            file.name
        );

        // ----------------------------------
        // CHECK PDF
        // ----------------------------------

        const isPDF =
            file.type === "application/pdf" ||
            file.name.toLowerCase().endsWith(".pdf");

        if (!isPDF) {

            uploadStatus.textContent =
                "Please select a PDF file.";

            return;
        }

        // ----------------------------------
        // DISABLE BUTTON
        // ----------------------------------

        uploadButton.disabled = true;

        uploadStatus.textContent =
            "Uploading PDF...";

        responseBox.textContent =
            "Please wait...";

        try {

            // ==================================
            // CREATE FORM DATA
            // ==================================

            const formData =
                new FormData();

            formData.append(
                "document",
                file
            );

            console.log(
                "Sending PDF to backend..."
            );

            // ==================================
            // SEND PDF
            // ==================================

            const response =
                await fetch(
                    `${API_BASE}/api/documents/upload`,
                    {
                        method: "POST",
                        body: formData
                    }
                );

            console.log(
                "Upload status:",
                response.status
            );

            // ==================================
            // READ RESPONSE
            // ==================================

            let data = {};

            try {

                data =
                    await response.json();

            } catch (jsonError) {

                console.error(
                    "JSON ERROR:",
                    jsonError
                );

                throw new Error(
                    "Server returned an invalid response."
                );
            }

            console.log(
                "Upload response:",
                data
            );

            // ==================================
            // SUCCESS
            // ==================================

            if (response.ok && data.success) {

                currentDocumentId =
                    data.documentId;

                uploadStatus.textContent =
                    "PDF uploaded successfully.";

                responseBox.textContent =
                    "PDF is ready. Ask a question.";

                console.log(
                    "Document ID:",
                    currentDocumentId
                );

                console.log(
                    "Questions found:",
                    data.questionsFound
                );

                return;
            }

            // ==================================
            // SCANNED PDF
            // ==================================

            const message =
                String(
                    data.message || ""
                ).toLowerCase();

            const scannedPDF =
                message.includes("scanned") ||
                message.includes("image-only") ||
                message.includes("image only") ||
                message.includes("extract enough text");

            if (
                response.status === 400 &&
                scannedPDF
            ) {

                console.log(
                    "Scanned PDF detected."
                );

                uploadStatus.textContent =
                    "Scanned PDF detected. Starting OCR...";

                responseBox.textContent =
                    "Reading PDF pages...";

                await processScannedPDF(file);

                return;
            }

            // ==================================
            // OTHER SERVER ERROR
            // ==================================

            throw new Error(
                data.message ||
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
                "Upload failed. Check the error message above.";

        } finally {

            uploadButton.disabled = false;

        }
    }
);

// ==========================================
// OCR SCANNED PDF
// ==========================================

async function processScannedPDF(file) {

    let worker = null;

    try {

        console.log(
            "Starting browser OCR..."
        );

        // ==================================
        // READ PDF
        // ==================================

        uploadStatus.textContent =
            "Opening PDF...";

        const arrayBuffer =
            await file.arrayBuffer();

        const pdf =
            await pdfjsLib.getDocument({
                data: arrayBuffer
            }).promise;

        const totalPages =
            pdf.numPages;

        console.log(
            "Total pages:",
            totalPages
        );

        // ==================================
        // CREATE OCR WORKER
        // ==================================

        if (
            typeof Tesseract === "undefined"
        ) {

            throw new Error(
                "Tesseract OCR library was not loaded."
            );
        }

        worker =
            await Tesseract.createWorker(
                "eng"
            );

        // ==================================
        // OCR ALL PAGES
        // ==================================

        let completeText = "";

        for (
            let pageNumber = 1;
            pageNumber <= totalPages;
            pageNumber++
        ) {

            uploadStatus.textContent =
                `OCR processing page ${pageNumber} of ${totalPages}...`;

            responseBox.textContent =
                `Reading page ${pageNumber} of ${totalPages}...`;

            console.log(
                `OCR page ${pageNumber}/${totalPages}`
            );

            // ------------------------------
            // GET PAGE
            // ------------------------------

            const page =
                await pdf.getPage(
                    pageNumber
                );

            // ------------------------------
            // RENDER PAGE
            // ------------------------------

            const viewport =
                page.getViewport({
                    scale: 1.5
                });

            const canvas =
                document.createElement(
                    "canvas"
                );

            const context =
                canvas.getContext(
                    "2d"
                );

            canvas.width =
                Math.floor(
                    viewport.width
                );

            canvas.height =
                Math.floor(
                    viewport.height
                );

            await page.render({
                canvasContext:
                    context,

                viewport:
                    viewport
            }).promise;

            // ------------------------------
            // OCR PAGE
            // ------------------------------

            const result =
                await worker.recognize(
                    canvas
                );

            const pageText =
                result.data.text || "";

            console.log(
                `Page ${pageNumber} characters:`,
                pageText.length
            );

            completeText +=
                `\n\n--- PAGE ${pageNumber} ---\n\n`;

            completeText +=
                pageText;

            // ------------------------------
            // RELEASE CANVAS MEMORY
            // ------------------------------

            canvas.width = 1;
            canvas.height = 1;
        }

        // ==================================
        // TERMINATE OCR WORKER
        // ==================================

        await worker.terminate();

        worker = null;

        completeText =
            completeText.trim();

        console.log(
            "Total OCR characters:",
            completeText.length
        );

        // ==================================
        // CHECK OCR RESULT
        // ==================================

        if (
            completeText.length < 20
        ) {

            throw new Error(
                "OCR could not read enough text from this PDF."
            );
        }

        // ==================================
        // SAVE OCR TEXT
        // ==================================

        uploadStatus.textContent =
            "OCR completed. Saving document...";

        responseBox.textContent =
            "Saving extracted text...";

        console.log(
            "Saving OCR text to backend..."
        );

        const saveResponse =
            await fetch(
                `${API_BASE}/api/documents/text`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        fileName:
                            file.name,

                        text:
                            completeText
                    })
                }
            );

        console.log(
            "OCR save status:",
            saveResponse.status
        );

        // ==================================
        // READ SAVE RESPONSE
        // ==================================

        let saveData = {};

        try {

            saveData =
                await saveResponse.json();

        } catch (error) {

            throw new Error(
                "OCR save returned an invalid response."
            );
        }

        console.log(
            "OCR save response:",
            saveData
        );

        // ==================================
        // SAVE ERROR
        // ==================================

        if (
            !saveResponse.ok ||
            !saveData.success
        ) {

            throw new Error(
                saveData.message ||
                `OCR save failed (${saveResponse.status}).`
            );
        }

        // ==================================
        // SUCCESS
        // ==================================

        currentDocumentId =
            saveData.documentId;

        uploadStatus.textContent =
            `Scanned PDF processed successfully. ` +
            `Characters: ${completeText.length}`;

        responseBox.textContent =
            "PDF is ready. Ask a question.";

        console.log(
            "OCR document ID:",
            currentDocumentId
        );

    } catch (error) {

        console.error(
            "OCR ERROR:",
            error
        );

        // ----------------------------------
        // TERMINATE WORKER IF NEEDED
        // ----------------------------------

        if (worker) {

            try {

                await worker.terminate();

            } catch (terminateError) {

                console.error(
                    "Worker termination error:",
                    terminateError
                );
            }
        }

        throw error;
    }
}

// ==========================================
// ASK AI
// ==========================================

askButton.addEventListener(
    "click",
    async function () {

        console.log(
            "Ask button clicked."
        );

        const question =
            questionInput.value.trim();

        // ==================================
        // CHECK QUESTION
        // ==================================

        if (!question) {

            responseBox.textContent =
                "Please enter a question.";

            return;
        }

        // ==================================
        // LOAD LATEST DOCUMENT IF NEEDED
        // ==================================

        if (!currentDocumentId) {

            await loadLatestDocument();
        }

        // ==================================
        // CHECK DOCUMENT
        // ==================================

        if (!currentDocumentId) {

            responseBox.textContent =
                "Please upload a PDF first.";

            return;
        }

        // ==================================
        // DISABLE ASK BUTTON
        // ==================================

        askButton.disabled = true;

        responseBox.textContent =
            "Searching your document...";

        try {

            // ==================================
            // CREATE SEARCH URL
            // ==================================

            const url =
                `${API_BASE}/api/documents/search` +
                `?documentId=${encodeURIComponent(
                    currentDocumentId
                )}` +
                `&q=${encodeURIComponent(
                    question
                )}`;

            console.log(
                "Search URL:",
                url
            );

            // ==================================
            // SEARCH
            // ==================================

            const response =
                await fetch(url);

            console.log(
                "Search status:",
                response.status
            );

            // ==================================
            // READ RESPONSE
            // ==================================

            let data = {};

            try {

                data =
                    await response.json();

            } catch (error) {

                throw new Error(
                    "Server returned an invalid search response."
                );
            }

            console.log(
                "Search response:",
                data
            );

            // ==================================
            // SEARCH ERROR
            // ==================================

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

            // ==================================
            // SHOW ANSWER
            // ==================================

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

// ==========================================
// ENTER KEY
// ==========================================

questionInput.addEventListener(
    "keydown",
    function (event) {

        if (
            event.key === "Enter"
        ) {

            event.preventDefault();

            askButton.click();
        }
    }
);

// ==========================================
// FILE SELECTED
// ==========================================

documentInput.addEventListener(
    "change",
    function () {

        const file =
            documentInput.files[0];

        if (!file) {

            uploadStatus.textContent =
                "No document selected.";

            return;
        }

        console.log(
            "Selected:",
            file.name
        );

        uploadStatus.textContent =
            `Selected: ${file.name}`;

        responseBox.textContent =
            "Ready to upload.";
    }
);

// ==========================================
// START APPLICATION
// ==========================================

async function startApp() {

    console.log(
        "AI Study Assistant starting..."
    );

    await checkBackend();

    await loadLatestDocument();

    console.log(
        "AI Study Assistant ready."
    );
}

startApp();