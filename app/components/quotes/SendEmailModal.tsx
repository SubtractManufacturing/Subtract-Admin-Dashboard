import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import { InputField, TextareaField, SelectField } from "../shared/FormField";

interface SendAsAddress {
  email: string;
  label: string;
}

interface SendEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  quoteNumber: string;
  customerEmail?: string;
  sendAsAddresses?: SendAsAddress[];
}

export default function SendEmailModal({
  isOpen,
  onClose,
  quoteNumber,
  customerEmail,
  sendAsAddresses = [],
}: SendEmailModalProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [formData, setFormData] = useState({
    from: "",
    to: "",
    subject: "",
    body: "",
  });
  const [errors, setErrors] = useState({
    to: "",
    subject: "",
    body: "",
  });

  const isSubmitting = fetcher.state === "submitting";
  const isSuccess = fetcher.data?.success;
  const serverError = fetcher.data?.error;

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        from: sendAsAddresses[0]?.email || "",
        to: customerEmail || "",
        subject: `Quote ${quoteNumber}`,
        body: "",
      });
      setErrors({ to: "", subject: "", body: "" });
    }
  }, [isOpen, quoteNumber, customerEmail, sendAsAddresses]);

  // Close modal on successful submission
  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        handleClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isSuccess]);

  const handleClose = () => {
    setFormData({ from: "", to: "", subject: "", body: "" });
    setErrors({ to: "", subject: "", body: "" });
    onClose();
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error when user starts typing
    if (errors[field as keyof typeof errors]) {
      setErrors((prev) => ({
        ...prev,
        [field]: "",
      }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors = { to: "", subject: "", body: "" };
    let isValid = true;

    if (!formData.to || formData.to.trim() === "") {
      newErrors.to = "Recipient email is required";
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.to)) {
      newErrors.to = "Please enter a valid email address";
      isValid = false;
    }

    if (!formData.subject || formData.subject.trim() === "") {
      newErrors.subject = "Subject is required";
      isValid = false;
    }

    if (!formData.body || formData.body.trim() === "") {
      newErrors.body = "Message body is required";
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    fetcher.submit(
      {
        intent: "sendEmail",
        from: formData.from,
        to: formData.to,
        subject: formData.subject,
        body: formData.body,
      },
      { method: "post" }
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Send Email">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Success Message */}
        {isSuccess && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center">
              <svg
                className="w-5 h-5 text-green-600 dark:text-green-400 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span className="text-green-800 dark:text-green-200 font-medium">
                Email sent successfully!
              </span>
            </div>
          </div>
        )}

        {/* Error Message */}
        {serverError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center">
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-red-800 dark:text-red-200 font-medium">
                {serverError}
              </span>
            </div>
          </div>
        )}

        {/* From Field */}
        {sendAsAddresses.length > 1 ? (
          <SelectField
            label="From"
            name="from"
            value={formData.from}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              handleChange("from", e.target.value)
            }
            required
            disabled={isSubmitting}
          >
            {sendAsAddresses.map((addr) => (
              <option key={addr.email} value={addr.email}>
                {addr.label} &lt;{addr.email}&gt;
              </option>
            ))}
          </SelectField>
        ) : sendAsAddresses.length === 1 ? (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              From
            </label>
            <div className="text-sm text-gray-900 dark:text-gray-100 py-2">
              {sendAsAddresses[0].label} &lt;{sendAsAddresses[0].email}&gt;
            </div>
          </div>
        ) : null}

        {/* To Field */}
        <InputField
          label="To"
          name="to"
          type="email"
          value={formData.to}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            handleChange("to", e.target.value)
          }
          required
          placeholder="recipient@example.com"
          error={errors.to}
          disabled={isSubmitting}
        />

        {/* Subject Field */}
        <InputField
          label="Subject"
          name="subject"
          type="text"
          value={formData.subject}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            handleChange("subject", e.target.value)
          }
          required
          placeholder="Email subject"
          error={errors.subject}
          disabled={isSubmitting}
        />

        {/* Body Field */}
        <TextareaField
          label="Message"
          name="body"
          value={formData.body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            handleChange("body", e.target.value)
          }
          required
          placeholder="Type your message here..."
          rows={8}
          error={errors.body}
          disabled={isSubmitting}
        />

        <div className="flex justify-end space-x-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Sending...
              </span>
            ) : (
              "Send Email"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

