const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// --------------------------------------------------
// UPLOAD FOLDER
// --------------------------------------------------

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --------------------------------------------------
// MULTER CONFIGURATION
// --------------------------------------------------

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },

    filename: function (req, file, cb) {
        const uniqueName =
            Date.now() +
            "-" +
            Math.round(Math.random() * 1e9) +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024
    }
});

// --------------------------------------------------
// TEXT CLEANING
// --------------------------------------------------

function cleanPdfText(text) {
    if (!text) return "";

    return text
        // Remove page markers
        .replace(/---\s*PAGE\s*\d+\s*---/gi, "")
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
        .replace(/\b\d+\s+of\s+\d+\b/gi, "")

        // Remove repeated academic header/footer
        .replace(
            /Dr\s+C\s+Murugamani[\s\S]*?gmail\.com/gi,
            ""
        )

        // Remove excessive separators
        .replace(/-{5,}/g, " ")

        // Remove excessive whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")

        .trim();
}

// --------------------------------------------------
// TOKENIZATION
// --------------------------------------------------

function normalizeWord(word) {
    return word
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function getWords(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map(normalizeWord)
        .filter(word => word.length > 2);
}

// --------------------------------------------------
// STOP WORDS
// --------------------------------------------------

const stopWords = new Set([
    "what",
    "why",
    "how",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "with",
    "from",
    "into",
    "about",
    "your",
    "their",
    "there",
    "they",
    "them",
    "have",
    "has",
    "had",
    "will",
    "would",
    "could",
    "should",
    "can",
    "may",
    "are",
    "was",
    "were",
    "been",
    "being",
    "for",
    "and",
    "the",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "at",
    "is",
    "it",
    "as",
    "or",
    "be",
    "do",
    "does",
    "did",
    "explain",
    "describe",
    "discuss",
    "define",
    "give",
    "state",
    "tell",
    "write",
    "mention",
    "about"
]);

function usefulWords(text) {
    return getWords(text).filter(word => !stopWords.has(word));
}

// --------------------------------------------------
// QUESTION NORMALIZATION
// --------------------------------------------------

function normalizeQuestion(question) {
    return question
        .toLowerCase()
        .replace(/[?.,!:'"()\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// --------------------------------------------------
// QUESTION NUMBER EXTRACTION
// --------------------------------------------------

function extractQuestionNumber(question) {
    const match = question.match(
        /(?:question\s*)?(\d+)\s*(?:a|b)?/i
    );

    return match ? match[1] : null;
}

// --------------------------------------------------
// QUESTION-ANSWER SECTION SPLITTER
// --------------------------------------------------

function splitIntoSections(text) {
    const sections = [];

    // Match common academic question formats:
    // 1.
    // 1)
    // 1.1
    // 12(a)
    // Question 1
    // 12(a). Explain...
    const regex =
        /(?=(?:^|\n)\s*(?:Question\s*)?\d+(?:\.\d+)?\s*(?:\([a-zA-Z]\))?\s*[\.\):\-])/gi;

    const parts = text.split(regex);

    for (let part of parts) {
        part = part.trim();

        if (part.length >= 50) {
            sections.push(part);
        }
    }

    // If splitting failed, divide into paragraphs
    if (sections.length < 2) {
        const paragraphs = text
            .split(/\n\s*\n/)
            .map(p => p.trim())
            .filter(p => p.length >= 50);

        return paragraphs;
    }

    return sections;
}

// --------------------------------------------------
// SCORE SECTION
// --------------------------------------------------

function scoreSection(section, question) {
    const normalizedSection = normalizeQuestion(section);
    const words = usefulWords(question);

    if (words.length === 0) {
        return 0;
    }

    let score = 0;

    // Count matching words
    for (const word of words) {
        if (normalizedSection.includes(word)) {
            score += 2;
        }
    }

    // Strong score if the question itself appears
    const cleanQuestion = normalizeQuestion(question);

    if (
        cleanQuestion.length > 8 &&
        normalizedSection.includes(cleanQuestion)
    ) {
        score += 30;
    }

    // Give extra weight to the first 500 characters
    const beginning = normalizedSection.substring(0, 500);

    for (const word of words) {
        if (beginning.includes(word)) {
            score += 4;
        }
    }

    // Question words near beginning are especially important
    const questionKeywords = [
        "definition",
        "importance",
        "advantages",
        "applications",
        "challenges",
        "evolution",
        "role",
        "types",
        "features",
        "architecture",
        "explain",
        "compare",
        "difference",
        "need"
    ];

    for (const keyword of questionKeywords) {
        if (
            cleanQuestion.includes(keyword) &&
            normalizedSection.includes(keyword)
        ) {
            score += 5;
        }
    }

    return score;
}

// --------------------------------------------------
// FORMAT ANSWER
// --------------------------------------------------

function formatAnswer(text) {
    if (!text) return "";

    let answer = text;

    // Remove page markers
    answer = answer
        .replace(/---\s*PAGE\s*\d+\s*---/gi, "")
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
        .replace(/\b\d+\s+of\s+\d+\b/gi, "");

    // Remove repeated header
    answer = answer.replace(
        /Dr\s+C\s+Murugamani[\s\S]*?gmail\.com/gi,
        ""
    );

    // Remove excessive spaces
    answer = answer.replace(/[ \t]+/g, " ");

    // Clean excessive blank lines
    answer = answer.replace(/\n{3,}/g, "\n\n");

    return answer.trim();
}

// --------------------------------------------------
// CREATE CHUNKS
// --------------------------------------------------

function createChunks(text, chunkSize = 1200, overlap = 250) {
    const chunks = [];

    if (!text) return chunks;

    let start = 0;

    while (start < text.length) {
        let end = start + chunkSize;

        if (end < text.length) {
            const breakPoint = text.lastIndexOf(" ", end);

            if (breakPoint > start + 500) {
                end = breakPoint;
            }
        }

        const chunk = text.substring(start, end).trim();

        if (chunk.length > 50) {
            chunks.push(chunk);
        }

        start = end - overlap;

        if (start < 0) {
            start = 0;
        }
    }

    return chunks;
}

// --------------------------------------------------
// SAVE DOCUMENT + CHUNKS
// --------------------------------------------------

async function saveDocument(fileName, filePath, extractedText) {
    const cleanText = cleanPdfText(extractedText);

    const [result] = await db.promise().query(
        `
        INSERT INTO documents
        (file_name, file_path, extracted_text)
        VALUES (?, ?, ?)
        `,
        [
            fileName,
            filePath,
            cleanText
        ]
    );

    const documentId = result.insertId;

    const chunks = createChunks(cleanText);

    for (let i = 0; i < chunks.length; i++) {
        await db.promise().query(
            `
            INSERT INTO document_chunks
            (document_id, chunk_index, chunk_text)
            VALUES (?, ?, ?)
            `,
            [
                documentId,
                i,
                chunks[i]
            ]
        );
    }

    return {
        documentId,
        chunksCreated: chunks.length,
        characters: cleanText.length
    };
}

// ==================================================
// TEST ROUTE
// ==================================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "AI Study Assistant backend is running."
    });
});

// ==================================================
// PDF UPLOAD
// ==================================================

app.post(
    "/api/documents/upload",
    upload.single("document"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "No PDF file uploaded."
                });
            }

            const filePath = req.file.path;

            const pdfBuffer = fs.readFileSync(filePath);

            const parser = new PDFParse({
                data: pdfBuffer
            });

            const result = await parser.getText();

            const extractedText = cleanPdfText(
                result.text || ""
            );

            await parser.destroy();

            // If almost no text was extracted,
            // tell frontend to use browser OCR.
            if (extractedText.length < 50) {
                return res.status(422).json({
                    success: false,
                    scanned: true,
                    message:
                        "This PDF appears to be scanned/image-based. Browser OCR is required.",
                    fileName: req.file.originalname
                });
            }

            const saved = await saveDocument(
                req.file.originalname,
                filePath,
                extractedText
            );

            res.json({
                success: true,
                message: "PDF uploaded successfully.",
                documentId: saved.documentId,
                chunksCreated: saved.chunksCreated,
                characters: saved.characters,
                scanned: false
            });

        } catch (error) {
            console.error(
                "PDF upload error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "PDF processing failed.",
                error: error.message
            });
        }
    }
);

// ==================================================
// SAVE OCR TEXT
// ==================================================

app.post(
    "/api/documents/text",
    async (req, res) => {
        try {
            const {
                fileName,
                text
            } = req.body;

            if (!fileName || !text) {
                return res.status(400).json({
                    success: false,
                    message:
                        "fileName and text are required."
                });
            }

            const cleanText = cleanPdfText(text);

            if (cleanText.length < 50) {
                return res.status(400).json({
                    success: false,
                    message:
                        "OCR did not produce enough text."
                });
            }

            const saved = await saveDocument(
                fileName,
                "",
                cleanText
            );

            res.json({
                success: true,
                message:
                    "OCR text saved successfully.",
                documentId: saved.documentId,
                chunksCreated:
                    saved.chunksCreated,
                characters:
                    saved.characters
            });

        } catch (error) {
            console.error(
                "OCR save error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to save OCR text.",
                error: error.message
            });
        }
    }
);

// ==================================================
// GET LATEST DOCUMENT
// ==================================================

app.get(
    "/api/documents/latest",
    async (req, res) => {
        try {
            const [rows] = await db.promise().query(
                `
                SELECT
                    id,
                    file_name,
                    CHAR_LENGTH(extracted_text) AS text_length,
                    created_at
                FROM documents
                ORDER BY id DESC
                LIMIT 1
                `
            );

            if (rows.length === 0) {
                return res.json({
                    success: false,
                    message:
                        "No document uploaded."
                });
            }

            res.json({
                success: true,
                document: rows[0]
            });

        } catch (error) {
            console.error(
                "Latest document error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to get latest document."
            });
        }
    }
);

// ==================================================
// IMPROVED SEARCH
// ==================================================

app.get(
    "/api/documents/search",
    async (req, res) => {
        try {
            const question =
                (req.query.q || "").trim();

            if (!question) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Question is required."
                });
            }

            // Get latest uploaded document
            const [documents] =
                await db.promise().query(
                    `
                    SELECT
                        id,
                        file_name,
                        extracted_text
                    FROM documents
                    WHERE extracted_text IS NOT NULL
                    AND CHAR_LENGTH(extracted_text) > 50
                    ORDER BY id DESC
                    LIMIT 1
                    `
                );

            if (documents.length === 0) {
                return res.json({
                    success: false,
                    message:
                        "No document uploaded yet."
                });
            }

            const document =
                documents[0];

            const cleanText =
                cleanPdfText(
                    document.extracted_text
                );

            // ------------------------------------------
            // Split into question/answer sections
            // ------------------------------------------

            const sections =
                splitIntoSections(
                    cleanText
                );

            let results = [];

            for (
                let i = 0;
                i < sections.length;
                i++
            ) {
                const section =
                    sections[i];

                const score =
                    scoreSection(
                        section,
                        question
                    );

                if (score > 0) {
                    results.push({
                        section,
                        score,
                        index: i
                    });
                }
            }

            // ------------------------------------------
            // Sort best matching section first
            // ------------------------------------------

            results.sort(
                (a, b) =>
                    b.score - a.score
            );

            if (results.length === 0) {
                return res.json({
                    success: false,
                    message:
                        "I could not find a relevant answer in the uploaded document."
                });
            }

            // ------------------------------------------
            // Take best result
            // ------------------------------------------

            let bestAnswer =
                formatAnswer(
                    results[0].section
                );

            // ------------------------------------------
            // Add nearby section if answer is very short
            // ------------------------------------------

            if (
                bestAnswer.length < 500 &&
                results.length > 1
            ) {
                const second =
                    formatAnswer(
                        results[1].section
                    );

                if (
                    second.length > 100
                ) {
                    bestAnswer +=
                        "\n\n" +
                        second;
                }
            }

            // ------------------------------------------
            // Prevent massive output
            // ------------------------------------------

            if (
                bestAnswer.length > 10000
            ) {
                bestAnswer =
                    bestAnswer.substring(
                        0,
                        10000
                    ) + "...";
            }

            res.json({
                success: true,

                fileName:
                    document.file_name,

                question,

                answer:
                    bestAnswer,

                score:
                    results[0].score,

                matches:
                    results.length
            });

        } catch (error) {
            console.error(
                "Search error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Search failed.",
                error:
                    error.message
            });
        }
    }
);

// ==================================================
// SERVER START
// ==================================================

app.listen(
    PORT,
    () => {
        console.log(
            `Server running on http://localhost:${PORT}`
        );

        console.log(
            "AI Study Assistant backend ready."
        );
    }
);