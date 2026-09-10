import * as pdfjsLib from
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";


// ============================================================
// BACKEND URL
// ============================================================

const API_BASE = "http://localhost:5000";


// ============================================================
// PDF.JS WORKER
// ============================================================

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";


// ============================================================
// ACTIVE DOCUMENT
// ============================================================

let activeDocumentId = null;


// ============================================================
// HTML ELEMENTS
// ============================================================

const fileInput =
    document.getElementById("document");

const uploadButton =
    document.getElementById("uploadButton");

const uploadStatus =
    document.getElementById("uploadStatus");

const questionInput =
    document.getElementById("question");

const askButton =
    document.getElementById("askButton");

const responseElement =
    document.getElementById("response");


// ============================================================
// LOAD LATEST DOCUMENT
// ============================================================

async function loadLatestDocument() {

    try {

        const response =
            await fetch(
                `${API_BASE}/api/documents/latest`
            );

        if (!response.ok) {

            activeDocumentId = null;

            uploadStatus.textContent =
                "No document uploaded yet.";

            return;
        }

        const data =
            await response.json();

        if (data && data.id) {

            activeDocumentId =
                data.id;

            uploadStatus.textContent =
                `Using document: ${data.file_name}`;
        }

    } catch (error) {

        console.error(
            "Latest document error:",
            error
        );

        uploadStatus.textContent =
            "Backend is not connected.";
    }
}


// ============================================================
// NORMAL PDF UPLOAD
// ============================================================

async function uploadNormalPDF(file) {

    const formData =
        new FormData();

    formData.append(
        "document",
        file
    );

    uploadStatus.textContent =
        "Checking PDF text...";

    const response =
        await fetch(
            `${API_BASE}/api/documents/upload`,
            {
                method: "POST",
                body: formData
            }
        );

    let data;

    try {

        data =
            await response.json();

    } catch {

        throw new Error(
            "Invalid response from backend."
        );
    }

    if (!response.ok) {

        const error =
            new Error(
                data.message ||
                "PDF upload failed."
            );

        error.scanned =
            data.scanned === true;

        throw error;
    }

    return data;
}


// ============================================================
// RENDER PDF PAGE
// ============================================================

async function renderPDFPage(page) {

    /*
        Higher scale = better OCR quality.

        2.0 is a good balance between:
        - OCR accuracy
        - RAM usage
        - browser performance
    */

    const scale = 2.0;

    const viewport =
        page.getViewport({
            scale: scale
        });

    const canvas =
        document.createElement("canvas");

    const context =
        canvas.getContext("2d", {
            willReadFrequently: true
        });

    canvas.width =
        Math.floor(viewport.width);

    canvas.height =
        Math.floor(viewport.height);

    await page.render({

        canvasContext:
            context,

        viewport:
            viewport

    }).promise;

    return canvas;
}


// ============================================================
// OCR ONE PAGE
// ============================================================

async function ocrPage(
    worker,
    page,
    pageNumber,
    totalPages
) {

    uploadStatus.textContent =
        `OCR: processing page ${pageNumber} of ${totalPages}...`;

    console.log(
        `OCR page ${pageNumber}/${totalPages}`
    );

    const canvas =
        await renderPDFPage(page);

    try {

        const result =
            await worker.recognize(
                canvas
            );

        const text =
            (
                result?.data?.text ||
                ""
            ).trim();

        console.log(
            `Page ${pageNumber}: ${text.length} characters`
        );

        return text;

    } finally {

        /*
            Free canvas memory after each page.
        */

        canvas.width = 1;
        canvas.height = 1;
    }
}


// ============================================================
// OCR ENTIRE PDF
// ============================================================

async function performOCR(file) {

    uploadStatus.textContent =
        "Loading PDF for OCR...";

    console.log(
        "Starting OCR..."
    );

    if (
        typeof Tesseract ===
        "undefined"
    ) {

        throw new Error(
            "Tesseract.js failed to load."
        );
    }

    // --------------------------------------------------------
    // LOAD PDF
    // --------------------------------------------------------

    const arrayBuffer =
        await file.arrayBuffer();

    const pdf =
        await pdfjsLib
            .getDocument({
                data: arrayBuffer
            })
            .promise;

    const totalPages =
        pdf.numPages;

    console.log(
        "Total pages:",
        totalPages
    );


    // --------------------------------------------------------
    // CREATE OCR WORKER
    // --------------------------------------------------------

    uploadStatus.textContent =
        "Starting OCR engine...";

    const worker =
        await Tesseract.createWorker(
            "eng"
        );


    const pageTexts = [];

    let totalCharacters = 0;


    try {

        // ----------------------------------------------------
        // PROCESS EVERY PAGE
        // ----------------------------------------------------

        for (
            let pageNumber = 1;
            pageNumber <= totalPages;
            pageNumber++
        ) {

            const page =
                await pdf.getPage(
                    pageNumber
                );

            const text =
                await ocrPage(
                    worker,
                    page,
                    pageNumber,
                    totalPages
                );


            /*
                IMPORTANT:

                Do NOT add:

                --- PAGE 1 ---

                because those page markers were causing
                your database to contain fake text.
            */

            if (
                text.length > 5
            ) {

                pageTexts.push(
                    text
                );

                totalCharacters +=
                    text.length;
            }


            // Release page reference
            page.cleanup();


            // Give browser time to breathe
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        20
                    )
            );
        }


    } finally {

        await worker.terminate();
    }


    // --------------------------------------------------------
    // COMBINE REAL OCR TEXT
    // --------------------------------------------------------

    const completeText =
        pageTexts
            .join("\n\n")
            .trim();


    console.log(
        "================================"
    );

    console.log(
        "OCR COMPLETE"
    );

    console.log(
        "Pages:",
        totalPages
    );

    console.log(
        "Pages with text:",
        pageTexts.length
    );

    console.log(
        "OCR characters:",
        totalCharacters
    );

    console.log(
        "================================"
    );


    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (
        completeText.length < 100
    ) {

        throw new Error(
            "OCR could not read enough text from this PDF. The PDF may have very low-quality/scanned pages."
        );
    }


    return completeText;
}


// ============================================================
// SAVE OCR TEXT
// ============================================================

async function saveOCRText(
    file,
    extractedText
) {

    uploadStatus.textContent =
        "Saving OCR text to database...";


    const response =
        await fetch(
            `${API_BASE}/api/documents/text`,
            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({

                        fileName:
                            file.name,

                        text:
                            extractedText
                    })
            }
        );


    let data;


    try {

        data =
            await response.json();

    } catch {

        throw new Error(
            "Invalid response from backend."
        );
    }


    if (
        !response.ok
    ) {

        throw new Error(
            data.message ||
            "OCR save failed."
        );
    }


    return data;
}


// ============================================================
// UPLOAD BUTTON
// ============================================================

uploadButton.addEventListener(
    "click",
    async () => {

        const file =
            fileInput.files[0];


        if (!file) {

            uploadStatus.textContent =
                "Please select a PDF.";

            return;
        }


        if (
            file.type !==
                "application/pdf" &&
            !file.name
                .toLowerCase()
                .endsWith(".pdf")
        ) {

            uploadStatus.textContent =
                "Only PDF files are allowed.";

            return;
        }


        uploadButton.disabled =
            true;

        askButton.disabled =
            true;


        responseElement.textContent =
            "AI response will appear here...";


        try {

            // ==================================================
            // NORMAL TEXT EXTRACTION
            // ==================================================

            try {

                const data =
                    await uploadNormalPDF(
                        file
                    );


                activeDocumentId =
                    data.documentId;


                uploadStatus.textContent =
                    `PDF uploaded successfully. ${data.chunksFound} chunks created. Extracted ${data.extractedCharacters} characters.`;


                console.log(
                    "Normal upload:",
                    data
                );


                /*
                    IMPORTANT:

                    If extraction is suspiciously small,
                    run OCR anyway.

                    Example:
                    148-page PDF + 500 characters
                    = almost certainly bad extraction.
                */

                if (
                    data.extractedCharacters <
                    5000
                ) {

                    console.log(
                        "Low text extraction detected."
                    );

                    uploadStatus.textContent =
                        `Only ${data.extractedCharacters} characters were extracted. Starting OCR...`;


                    const ocrText =
                        await performOCR(
                            file
                        );


                    const saved =
                        await saveOCRText(
                            file,
                            ocrText
                        );


                    activeDocumentId =
                        saved.documentId;


                    uploadStatus.textContent =
                        `OCR completed successfully. ${saved.chunksFound} chunks created. Extracted ${saved.extractedCharacters} characters.`;

                }


                return;

            } catch (error) {

                // ==============================================
                // SCANNED PDF
                // ==============================================

                if (
                    error.scanned ===
                    true
                ) {

                    console.log(
                        "Scanned PDF detected."
                    );


                    uploadStatus.textContent =
                        "Scanned PDF detected. Starting OCR...";


                    const ocrText =
                        await performOCR(
                            file
                        );


                    const saved =
                        await saveOCRText(
                            file,
                            ocrText
                        );


                    activeDocumentId =
                        saved.documentId;


                    uploadStatus.textContent =
                        `OCR completed successfully. ${saved.chunksFound} chunks created. Extracted ${saved.extractedCharacters} characters.`;

                    return;
                }


                throw error;
            }


        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );


            uploadStatus.textContent =
                "Upload failed: " +
                error.message;


        } finally {

            uploadButton.disabled =
                false;

            askButton.disabled =
                false;
        }
    }
);


// ============================================================
// ASK QUESTION
// ============================================================

askButton.addEventListener(
    "click",
    async () => {

        const question =
            questionInput.value.trim();


        if (!question) {

            responseElement.textContent =
                "Please enter a question.";

            return;
        }


        if (
            !activeDocumentId
        ) {

            await loadLatestDocument();
        }


        if (
            !activeDocumentId
        ) {

            responseElement.textContent =
                "Please upload a PDF first.";

            return;
        }


        responseElement.textContent =
            "Searching your study material...";


        askButton.disabled =
            true;


        try {

            const url =
                `${API_BASE}/api/documents/search` +
                `?documentId=${encodeURIComponent(
                    activeDocumentId
                )}` +
                `&q=${encodeURIComponent(
                    question
                )}`;


            console.log(
                "Searching:",
                url
            );


            const response =
                await fetch(
                    url
                );


            let data;


            try {

                data =
                    await response.json();

            } catch {

                throw new Error(
                    "Invalid response from backend."
                );
            }


            if (
                !response.ok
            ) {

                throw new Error(
                    data.message ||
                    "Search failed."
                );
            }


            responseElement.textContent =
                data.answer ||
                "No answer found.";


            console.log(
                "Search response:",
                data
            );


        } catch (error) {

            console.error(
                "QUESTION ERROR:",
                error
            );


            responseElement.textContent =
                "Error: " +
                error.message;


        } finally {

            askButton.disabled =
                false;
        }
    }
);


// ============================================================
// ENTER KEY
// ============================================================

questionInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Enter"
        ) {

            askButton.click();
        }
    }
);


// ============================================================
// START
// ============================================================

loadLatestDocument();