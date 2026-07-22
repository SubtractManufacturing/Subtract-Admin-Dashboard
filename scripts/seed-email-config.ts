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

  console.log("Seeding complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error seeding email configuration:", err);
  process.exit(1);
});
