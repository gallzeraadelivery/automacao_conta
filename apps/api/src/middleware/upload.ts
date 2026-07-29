import multer from "multer";

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", // some browsers send this for .csv
]);

export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const isAllowedExtension = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || isAllowedExtension) {
      return callback(null, true);
    }
    return callback(new Error("Formato de arquivo não suportado. Envie um .csv ou .xlsx"));
  },
});
