/**
 * Super-admin "Login branding" editor for one college (in CollegeManagePage).
 * Sets the public skin of /c/:slug/login — logo, display name, welcome line,
 * and an accent color — with a LIVE preview of the branded entrance and the
 * shareable URL to hand to the college. Persists via the existing college
 * update (branding is an additive field); the fixed "Supported by CodeApt"
 * footer is not editable.
 */
import type { CollegeBrandingFields } from "@codeapt/shared";
import { Copy, Check, Sparkles } from "lucide-react";
import { useState } from "react";

import { imageUrl } from "../../../lib/cloudinary.js";
import { Logo } from "../../brand/Logo.js";
import { ImageUpload } from "../../media/ImageUpload.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

export function LoginBrandingCard({
  collegeName,
  slug,
  branding,
  busy,
  onSave,
}: {
  collegeName: string;
  slug: string;
  branding: CollegeBrandingFields;
  busy: boolean;
  onSave: (branding: CollegeBrandingFields) => Promise<void>;
}) {
  const { toast } = useToast();
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl);
  const [displayName, setDisplayName] = useState(branding.displayName);
  const [welcomeText, setWelcomeText] = useState(branding.welcomeText);
  const [brandColor, setBrandColor] = useState(branding.brandColor);
  const [copied, setCopied] = useState(false);

  const shownName = displayName.trim() || collegeName;
  const accent = brandColor.trim() || undefined;
  const loginUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/c/${slug}/login`
      : `/c/${slug}/login`;

  const dirty =
    logoUrl !== branding.logoUrl ||
    displayName !== branding.displayName ||
    welcomeText !== branding.welcomeText ||
    brandColor !== branding.brandColor;

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ variant: "error", title: "Couldn't copy — copy it manually." });
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-ink">Login branding</h2>
      </div>
      <p className="mb-5 text-sm text-ink-muted">
        Skin this college&apos;s dedicated login page. Share the URL below — anyone
        who opens it sees this branding over the standard login.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Editor */}
        <div className="space-y-4">
          <FormField label="Logo">
            <ImageUpload value={logoUrl} onChange={setLogoUrl} disabled={busy} />
          </FormField>
          <FormField label="Display name" hint={`Defaults to “${collegeName}”.`}>
            <Input
              value={displayName}
              placeholder={collegeName}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </FormField>
          <FormField label="Welcome text" hint="A short tagline shown under the name.">
            <Textarea
              rows={2}
              value={welcomeText}
              placeholder="e.g. Sign in to your placement portal."
              disabled={busy}
              onChange={(e) => setWelcomeText(e.target.value)}
            />
          </FormField>
          <FormField label="Accent color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Accent color"
                value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(brandColor) ? brandColor : "#4f46e5"}
                disabled={busy}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-subtle bg-surface-base"
              />
              <Input
                value={brandColor}
                placeholder="#4f46e5"
                disabled={busy}
                onChange={(e) => setBrandColor(e.target.value)}
                className="max-w-[10rem]"
              />
              {brandColor ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setBrandColor("")}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </FormField>
        </div>

        {/* Live preview + shareable URL */}
        <div className="space-y-4">
          <p className="text-xs font-medium text-ink-muted">Preview</p>
          <div className="overflow-hidden rounded-2xl border border-subtle bg-surface-base">
            <div
              className="h-1.5 w-full"
              style={accent ? { backgroundColor: accent } : { backgroundColor: "rgb(var(--color-primary-500))" }}
            />
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              {logoUrl ? (
                <img
                  src={imageUrl(logoUrl)}
                  alt=""
                  className="mb-1 h-12 max-w-[180px] object-contain"
                />
              ) : (
                <div
                  className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-bold text-white"
                  style={{ backgroundColor: accent ?? "rgb(var(--color-primary-500))" }}
                  aria-hidden
                >
                  {shownName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-lg font-bold text-ink">{shownName}</div>
              <div className="text-xs text-ink-muted">
                {welcomeText.trim() || "Log in to continue."}
              </div>
              <div
                className="mt-3 w-full max-w-[220px] rounded-lg py-2 text-center text-sm font-medium text-white"
                style={{ backgroundColor: accent ?? "rgb(var(--color-primary-500))" }}
              >
                Log in
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-muted">
                Supported by <Logo className="h-3.5" />
              </div>
            </div>
          </div>

          <FormField label="Shareable login URL">
            <div className="flex items-center gap-2">
              <Input value={loginUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyUrl()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </FormField>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          disabled={busy || !dirty}
          loading={busy}
          onClick={() =>
            void onSave({
              logoUrl: logoUrl.trim(),
              displayName: displayName.trim(),
              welcomeText: welcomeText.trim(),
              brandColor: brandColor.trim(),
            })
          }
        >
          Save branding
        </Button>
      </div>
    </Card>
  );
}
