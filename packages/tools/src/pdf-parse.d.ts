declare module 'pdf-parse' {
  interface PDFData {
    numpages: number
    text: string
    info: Record<string, unknown>
  }
  function pdfParse(buffer: Buffer): Promise<PDFData>
  export default pdfParse
}
