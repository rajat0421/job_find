const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const MIN_TEXT_LENGTH = 80; // guard against empty/scanned-image resumes with no extractable text

// Maps an uploaded file's mimetype to our short type tag, or null if unsupported.
const detectType = (mimetype, originalname = '') => {
  const name = originalname.toLowerCase();
  if (mimetype === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) return 'docx';
  return null;
};

// Extract plain text from a PDF or DOCX buffer. Throws user-friendly errors.
const extractText = async (buffer, fileType) => {
  let text = '';
  try {
    if (fileType === 'pdf') {
      const data = await pdfParse(buffer);
      text = data.text || '';
    } else if (fileType === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } else {
      throw new Error('Unsupported file type');
    }
  } catch (err) {
    throw new Error(`Could not read the ${fileType.toUpperCase()} — it may be corrupt or password-protected`);
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < MIN_TEXT_LENGTH) {
    throw new Error('Could not extract enough text — if this is a scanned/image PDF, upload a text-based version');
  }
  return text;
};

module.exports = { detectType, extractText };
