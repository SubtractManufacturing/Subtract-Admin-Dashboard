import { db } from "../app/lib/db";
import {
  emailSettings,
  emailIdentities,
  emailTemplates,
} from "../app/lib/db/schema";
import { eq } from "drizzle-orm";
import { EMAIL_CONTEXT } from "../app/lib/email/email-context-registry";

async function main() {
  console.log("Seeding email configuration...");

  // 1. Seed email_settings
  const defaultSettings = [
    { key: "outbound_delay_minutes", value: "0" },
    { key: "recipient_override", value: "" },
    { key: "default_signature", value: "" },
    { key: "default_footer", value: "" },
  ];

  for (const setting of defaultSettings) {
    const existing = await db
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.key, setting.key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(emailSettings).values({
        key: setting.key,
        value: setting.value,
        updatedBy: "system",
      });
      console.log(`Inserted setting: ${setting.key}`);
    } else {
      console.log(`Setting already exists: ${setting.key}`);
    }
  }

  // 2. Seed email_identities (placeholder — archived until an admin configures a real sender)
  const defaultIdentityEmail = "quotes@subtract.com"; // Placeholder, should be updated by admin
  const existingDefault = await db
    .select()
    .from(emailIdentities)
    .where(eq(emailIdentities.isDefault, true))
    .limit(1);

  let identityId: number;

  if (existingDefault.length > 0) {
    identityId = existingDefault[0].id;
    console.log(`Default identity already exists: ${existingDefault[0].fromEmail}`);
  } else {
    const existingPlaceholder = await db
      .select()
      .from(emailIdentities)
      .where(eq(emailIdentities.fromEmail, defaultIdentityEmail))
      .limit(1);

    if (existingPlaceholder.length > 0) {
      identityId = existingPlaceholder[0].id;
      console.log(`Placeholder identity already exists: ${defaultIdentityEmail}`);
    } else {
      const [newIdentity] = await db
        .insert(emailIdentities)
        .values({
          fromEmail: defaultIdentityEmail,
          fromDisplayName: "Subtract Manufacturing",
          isDefault: false,
          isArchived: true,
          updatedBy: "system",
        })
        .returning();
      identityId = newIdentity.id;
      console.log(
        `Inserted archived placeholder identity: ${defaultIdentityEmail} (not default — configure in admin)`,
      );
    }
  }

  // 3. Seed email_templates (quote send — Styled quote layout)
  const existingTemplate = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.slug, "quote-send"))
    .limit(1);

  let templateId: number;

  if (existingTemplate.length === 0) {
    const [inserted] = await db
      .insert(emailTemplates)
      .values({
        slug: "quote-send",
        name: "Quote Send",
        layoutSlug: "styled-quote",
        contextKey: EMAIL_CONTEXT.QUOTE_SEND,
        emailIdentityId: identityId,
        requiredAttachmentDocumentKinds: ["quote"],
        subjectTemplate: "Your Quote {{quoteNumber}} from Subtract Manufacturing",
        toTemplate: "{{customerEmail}}",
        bodyCopy: {
          intro:
            "Hi {{customerName}},\n\nPlease find your quote **{{quoteNumber}}** attached.\n\n**Total:** {{total}}",
          cta: {
            buttonLabel: "Pay Now",
            link: "{{paymentLinkUrl}}",
          },
          wrapUp:
            "Best regards,\n\nSubtract Manufacturing\n\n{{default_signature}}",
          footerNotice: "{{default_footer}}",
        },
        updatedBy: "system",
      })
      .returning();
    templateId = inserted.id;
    console.log(`Inserted template: quote-send`);
  } else {
    templateId = existingTemplate[0].id;
    console.log(`Template already exists: quote-send`);
    await db
      .update(emailTemplates)
      .set({
        contextKey: EMAIL_CONTEXT.QUOTE_SEND,
        updatedAt: new Date(),
        updatedBy: "system",
      })
      .where(eq(emailTemplates.id, templateId));
  }
  console.log(
    `Assigned context ${EMAIL_CONTEXT.QUOTE_SEND} to template id ${templateId}`
  );

  const receivedTemplates = [
    {
      slug: "quote-auto-received",
      name: "Quote Received (Auto)",
      contextKey: EMAIL_CONTEXT.QUOTE_AUTO_CREATED,
      toTemplate: "{{submissionEmail}}",
      subjectTemplate:
        "We received your RFQ {{quoteNumber}} — Subtract Manufacturing",
      bodyCopy: {
        intro:
          "Hi {{submissionName}},\n\nThank you for submitting your request for quote **{{quoteNumber}}**. Our team is reviewing your files and will follow up with pricing soon.",
        wrapUp:
          "Best regards,\n\nSubtract Manufacturing\n\n{{default_signature}}",
        footerNotice: "{{default_footer}}",
      },
      requiredAttachmentDocumentKinds: [] as const,
    },
    {
      slug: "quote-manual-received",
      name: "Quote Received (Manual)",
      contextKey: EMAIL_CONTEXT.QUOTE_MANUAL_CREATED,
      toTemplate: "{{customerEmail}}",
      subjectTemplate:
        "We received your RFQ {{quoteNumber}} — Subtract Manufacturing",
      bodyCopy: {
        intro:
          "Hi {{customerName}},\n\nThank you for your request for quote **{{quoteNumber}}**. We received your RFQ and will follow up with pricing soon.",
        wrapUp:
          "Best regards,\n\nSubtract Manufacturing\n\n{{default_signature}}",
        footerNotice: "{{default_footer}}",
      },
      requiredAttachmentDocumentKinds: [] as const,
    },
  ] as const;

  for (const tpl of receivedTemplates) {
    const existing = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.slug, tpl.slug))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(emailTemplates).values({
        slug: tpl.slug,
        name: tpl.name,
        layoutSlug: "branded-markdown",
        contextKey: tpl.contextKey,
        emailIdentityId: identityId,
        subjectTemplate: tpl.subjectTemplate,
        toTemplate: tpl.toTemplate,
        bodyCopy: tpl.bodyCopy,
        requiredAttachmentDocumentKinds: [...tpl.requiredAttachmentDocumentKinds],
        updatedBy: "system",
      });
      console.log(`Inserted template: ${tpl.slug}`);
    } else {
      await db
        .update(emailTemplates)
        .set({
          contextKey: tpl.contextKey,
          updatedAt: new Date(),
          updatedBy: "system",
        })
        .where(eq(emailTemplates.id, existing[0].id));
      console.log(`Updated template: ${tpl.slug}`);
    }
  }

  console.log("Seeding complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error seeding email configuration:", err);
  process.exit(1);
});
