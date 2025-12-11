import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Tailwind,
  Link,
  Img,
  Row,
  Column,
} from "@react-email/components";

interface QuoteEmailProps {
  messageBody: string;
  subject: string;
  logoContentId?: string;
}

export const QuoteEmail = ({
  messageBody,
  subject,
  logoContentId = "company-logo",
}: QuoteEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans my-auto mx-auto px-2 py-8">
          <Container className="bg-white border border-gray-200 rounded-lg mx-auto w-full max-w-[580px] shadow-sm overflow-hidden">
            {/* Header with red accent */}
            <Section className="bg-white border-b-4 border-[#c41e3a] px-8 py-6">
              <Row>
                <Column width="60" align="left" valign="middle">
                  <Img
                    src={`cid:${logoContentId}`}
                    alt="Subtract"
                    width="50"
                    className="block"
                  />
                </Column>
                <Column align="center" valign="middle" className="pl-4">
                  <Heading className="text-[#2c3e50] text-[24px] font-bold p-0 m-0 leading-tight uppercase tracking-tight">
                    Subtract Manufacturing
                  </Heading>
                </Column>
              </Row>
            </Section>

            {/* Content Area */}
            <Section className="px-10 py-10" style={{ minHeight: "300px" }}>
              <Text className="text-[#2c3e50] text-[16px] leading-[28px] m-0 whitespace-pre-wrap">
                {messageBody}
              </Text>
            </Section>

            {/* Footer */}
            <Section className="bg-[#f8f9fa] border-t border-gray-200 px-8 py-4 text-center">
              <Text className="text-[#6c757d] text-[12px] leading-[20px] m-0 mb-2">
                <Link
                  href="https://subtractmanufacturing.com"
                  className="text-[#c41e3a] font-semibold no-underline"
                >
                  Subtract Manufacturing
                </Link>
              </Text>
              <Text className="text-[#adb5bd] text-[11px] leading-[18px] m-0">
                This email was sent from the Subtract Manufacturing platform.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default QuoteEmail;
