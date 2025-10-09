import puppeteer from "puppeteer";

export interface GeneratePdfOptions {
  html: string;
  filename?: string;
}

export async function generatePdf(
  options: GeneratePdfOptions
): Promise<Buffer> {
  const { html } = options;

  let browser = null;

  try {
    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    };

    // Only set executablePath if explicitly configured (for production)
    // Otherwise, let Puppeteer use its bundled Chromium (for local dev)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();

    // Set a timeout for page operations
    page.setDefaultTimeout(30000);

    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: {
        top: "0px",
        right: "0px",
        bottom: "0px",
        left: "0px",
      },
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw new Error(
      `Failed to generate PDF: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
