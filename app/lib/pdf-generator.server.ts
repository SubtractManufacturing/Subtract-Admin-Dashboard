import { launch } from "puppeteer";

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
    const launchOptions: Parameters<typeof launch>[0] = {
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

    browser = await launch(launchOptions);

    const page = await browser.newPage();

    // Set a timeout for page operations
    page.setDefaultTimeout(30000);

    await page.setContent(html, {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.waitForNetworkIdle({ timeout: 30000 });

    // Opt-in per-page footer: a template marks its footer with
    // data-pdf-page-footer. We lift it out of the flow and let Chrome stamp it
    // into the bottom margin of every page. The footer is rendered in an
    // isolated context, so it must be styled inline.
    const pageFooter = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-pdf-page-footer]");
      if (!el) return null;
      const footer = {
        html: el.outerHTML,
        height: el.dataset.pdfPageFooter || "0.6in",
      };
      el.remove();
      return footer;
    });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: pageFooter !== null,
      headerTemplate: "<span></span>",
      // Chrome pads its footer container; zero that so the footer sits flush
      // with the bottom edge of the page.
      footerTemplate: pageFooter
        ? `<style>#footer { padding: 0 !important; margin: 0 !important; align-items: flex-end; }</style>${pageFooter.html}`
        : "<span></span>",
      margin: {
        top: "0px",
        right: "0px",
        bottom: pageFooter?.height ?? "0px",
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
