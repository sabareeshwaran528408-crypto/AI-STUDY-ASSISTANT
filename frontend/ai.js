import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

// =====================================================
// RAILWAY BACKEND
// =====================================================

const API_BASE =
    "https://ai-study-assistant-production-ce2c.up.railway.app";

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

// =====================================================
// HTML ELEMENTS
// =====================================================

const fileInput = document.getElementById("document");
const uploadButton = document.getElementById("uploadButton");
const uploadStatus = document.getElementById("uploadStatus");

const questionInput = document.getElementById("question");
const askButton = document.getElementById("askButton");
const responseBox = document.getElementById("response");

// =====================================================
// CURRENT DOCUMENT
// =====================================================

let currentDocumentId = null;

// =====================================================
// INITIALIZE
// =====================================================

async function initialize() {
    try {
        uploadStatus.textContent = "Connecting to AI Study Assistant...";

        const response = await fetch(`${API_BASE}/`);

        if (!response.ok) {
            throw new Error("Backend is not responding.");
        }

        const data = await response.json();

        console.log("Backend:", data);

        await loadLatestDocument();

    } catch (error) {
        console.error(error);

        uploadStatus.textContent =
            "Backend connection failed. Please try again.";
    }
}

// =====================================================
// LOAD LATEST DOCUMENT
// =====================================================

async function loadLatestDocument() {
    try {
        const response =
            await fetch(`${API_BASE}/api/documents/latest`);

        if (!response.ok) {
            uploadStatus.textContent =
                "Backend connected. No document uploaded yet.";
            return;
        }

        const data = await response.json();

        currentDocumentId = data.id;

        uploadStatus.textContent =
            `Current document: ${data.file_name}`;

        console.log("Latest document:", data);

    } catch (error) {
        console.error("Latest document error:", error);

        uploadStatus.textContent =
            "Backend connected.";
    }
}

// =====================================================
// UPLOAD PDF
// =====================================================

uploadButton.addEventListener("click", async () => {

    const file = fileInput.files[0];

    if (!file) {
        uploadStatus.textContent =
            "Please select a PDF file first.";
        return;
    }

    if (file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")) {

        uploadStatus.textContent =
            "Only PDF files are allowed.";

        return;
    }

    try {

        uploadButton.disabled = true;

        uploadStatus.textContent =
            "Uploading PDF...";

        const formData = new FormData();

        formData.append("document", file);

        // =================================================
        // SEND PDF TO RAILWAY BACKEND
        // =================================================

        const response = await fetch(
            `${API_BASE}/api/documents/upload`,
            {
                method: "POST",
                body: formData
            }
        );

        const data = await response.json();

        console.log("Upload response:", data);

        // =================================================
        // NORMAL TEXT PDF
        // =================================================

        if (response.ok && data.success) {

            currentDocumentId =
                data.documentId;

            uploadStatus.textContent =
                `PDF uploaded successfully. ` +
                `${data.questionsFound || 0} questions found.`;

            responseBox.textContent =
                "Document is ready. Ask your question.";

            return;
        }

        // =================================================
        // SCANNED PDF
        // =================================================

        if (
            response.status === 400 &&
            data.message &&
            data.message.toLowerCase().includes("scanned")
        ) {

            uploadStatus.textContent =
                "Scanned PDF detected. Starting browser OCR...";

            await processScannedPDF(file);

            return;
        }

        // =================================================
        // OTHER ERROR
        // =================================================

        uploadStatus.textContent =
            data.message ||
            "PDF upload failed.";

    } catch (error) {

        console.error("Upload error:", error);

        uploadStatus.textContent =
            "Upload failed. Check your internet connection.";

    } finally {

        uploadButton.disabled = false;
    }
});

// =====================================================
// PROCESS SCANNED PDF USING OCR
// =====================================================

async function processScannedPDF(file) {

    let pdf = null;
    let worker = null;

    try {

        if (typeof Tesseract === "undefined") {

            throw new Error(
                "Tesseract.js was not loaded."
            );
        }

        uploadStatus.textContent =
            "Reading scanned PDF...";

        const arrayBuffer =
            await file.arrayBuffer();

        pdf =
            await pdfjsLib.getDocument({
                data: arrayBuffer
            }).promise;

        console.log(
            "PDF pages:",
            pdf.numPages
        );

        // =================================================
        // CREATE OCR WORKER
        // =================================================

        worker =
            await Tesseract.createWorker("eng");

        let completeText = "";

        // =================================================
        // OCR PAGE BY PAGE
        // =================================================

        for (
            let pageNumber = 1;
            pageNumber <= pdf.numPages;
            pageNumber++
        ) {

            uploadStatus.textContent =
                `OCR processing page ${pageNumber} of ${pdf.numPages}...`;

            const page =
                await pdf.getPage(pageNumber);

            const viewport =
                page.getViewport({
                    scale: 1.5
                });

            const canvas =
                document.createElement("canvas");

            const context =
                canvas.getContext("2d");

            canvas.width =
                viewport.width;

            canvas.height =
                viewport.height;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            const result =
                await worker.recognize(
                    canvas
                );

            const pageText =
                result.data.text || "";

            completeText +=
                `\n\n--- PAGE ${pageNumber} ---\n\n`;

            completeText +=
                pageText;

            // Release canvas memory
            canvas.width = 1;
            canvas.height = 1;
        }

        // =================================================
        // CLEAN OCR TEXT
        // =================================================

        completeText =
            cleanOCRText(completeText);

        console.log(
            "OCR characters:",
            completeText.length
        );

        if (completeText.length < 20) {

            throw new Error(
                "OCR could not extract enough text."
            );
        }

        uploadStatus.textContent =
            "OCR complete. Saving document...";

        // =================================================
        // SAVE OCR TEXT
        // =================================================

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
                        fileName: file.name,
                        text: completeText
                    })
                }
            );

        const saveData =
            await saveResponse.json();

        console.log(
            "OCR save response:",
            saveData
        );

        if (!saveResponse.ok ||
            !saveData.success) {

            throw new Error(
                saveData.message ||
                "Could not save OCR text."
            );
        }

        currentDocumentId =
            saveData.documentId;

        uploadStatus.textContent =
            `Scanned PDF processed successfully. ` +
            `${completeText.length.toLocaleString()} characters extracted.`;

        responseBox.textContent =
            "Document is ready. Ask your question.";

    } catch (error) {

        console.error(
            "OCR error:",
            error
        );

        uploadStatus.textContent =
            `OCR failed: ${error.message}`;

    } finally {

        if (worker) {

            try {
                await worker.terminate();
            } catch (error) {
                console.error(error);
            }
        }

        pdf = null;
    }
}

// =====================================================
// CLEAN OCR TEXT
// =====================================================

function cleanOCRText(text) {

    return text

        .replace(/\r/g, "\n")

        // Remove excessive spaces
        .replace(/[ \t]+/g, " ")

        // Remove excessive blank lines
        .replace(/\n{4,}/g, "\n\n")

        .trim();
}

// =====================================================
// ASK QUESTION
// =====================================================

askButton.addEventListener("click", async () => {

    const question =
        questionInput.value.trim();

    if (!question) {

        responseBox.textContent =
            "Please enter a question.";

        return;
    }

    // =================================================
    // MAKE SURE DOCUMENT EXISTS
    // =================================================

    if (!currentDocumentId) {

        await loadLatestDocument();

        if (!currentDocumentId) {

            responseBox.textContent =
                "Please upload a PDF first.";

            return;
        }
    }

    try {

        askButton.disabled = true;

        responseBox.textContent =
            "Searching your document...";

        // =================================================
        // SEARCH DOCUMENT
        // =================================================

        const url =
            `${API_BASE}/api/documents/search` +
            `?documentId=${encodeURIComponent(currentDocumentId)}` +
            `&q=${encodeURIComponent(question)}`;

        const response =
            await fetch(url);

        const data =
            await response.json();

        console.log(
            "Question response:",
            data
        );

        // =================================================
        // SUCCESS
        // =================================================

        if (response.ok && data.success) {

            responseBox.textContent =
                data.answer ||
                "No answer found.";

            return;
        }

        // =================================================
        // NO ANSWER
        // =================================================

        responseBox.textContent =
            data.message ||
            "No relevant information found.";

    } catch (error) {

        console.error(
            "Question error:",
            error
        );

        responseBox.textContent =
            "Could not connect to the backend.";

    } finally {

        askButton.disabled = false;
    }
});

// =====================================================
// ENTER KEY → ASK
// =====================================================

questionInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {

            event.preventDefault();

            askButton.click();
        }
    }
);

// =====================================================
// START
// =====================================================

initialize();