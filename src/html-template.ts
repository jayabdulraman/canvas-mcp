export interface BrandGuidelines {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  textColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
}

export interface BrandedPageSection {
  heading: string;
  body: string;
  callout?: string;
  links?: Array<{ label: string; url: string }>;
}

export interface BrandedPageInput {
  title: string;
  subtitle?: string;
  guidelines?: BrandGuidelines;
  sections: BrandedPageSection[];
}

const DEFAULTS: Required<BrandGuidelines> = {
  primaryColor: "#191919",
  secondaryColor: "#4a5568",
  accentColor: "#8c1d40",
  textColor: "#1f2933",
  backgroundColor: "#ffffff",
  fontFamily: "Arial, Helvetica, sans-serif",
};

const SAFE_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SAFE_FONT_FAMILY_PATTERN = /^[a-z0-9\s"',.-]+$/i;

export function renderBrandedPage(input: BrandedPageInput): string {
  const brand = sanitizeGuidelines(input.guidelines);

  return `
<div style="${style({
    fontFamily: brand.fontFamily,
    color: brand.textColor,
    backgroundColor: brand.backgroundColor,
    lineHeight: "1.6",
  })}">
  <div style="${style({
    borderLeft: `8px solid ${brand.accentColor}`,
    padding: "1rem 1.25rem",
    marginBottom: "1.5rem",
    backgroundColor: tint(brand.accentColor),
  })}">
    <h1 style="${style({ color: brand.primaryColor, margin: "0 0 0.5rem" })}">${escapeHtml(input.title)}</h1>
    ${input.subtitle ? `<p style="${style({ color: brand.secondaryColor, margin: "0" })}">${escapeHtml(input.subtitle)}</p>` : ""}
  </div>
  ${input.sections.map((section) => renderSection(section, brand)).join("\n")}
</div>`.trim();
}

function renderSection(section: BrandedPageSection, brand: Required<BrandGuidelines>): string {
  return `
  <section style="${style({
    border: `1px solid ${tint(brand.secondaryColor)}`,
    borderRadius: "12px",
    padding: "1rem",
    margin: "0 0 1rem",
  })}">
    <h2 style="${style({ color: brand.primaryColor, marginTop: "0" })}">${escapeHtml(section.heading)}</h2>
    ${renderPlainTextBody(section.body)}
    ${section.callout ? `<div style="${style({
      borderLeft: `4px solid ${brand.accentColor}`,
      padding: "0.75rem 1rem",
      marginTop: "1rem",
      backgroundColor: tint(brand.accentColor),
    })}">${escapeHtml(section.callout)}</div>` : ""}
    ${section.links?.length ? renderLinks(section.links, brand) : ""}
  </section>`.trim();
}

function renderLinks(links: Array<{ label: string; url: string }>, brand: Required<BrandGuidelines>): string {
  const items = links
    .map((link) => {
      const href = safeHref(link.url);
      if (!href) return "";
      return `<li><a href="${escapeAttribute(href)}" rel="noopener noreferrer" style="${style({ color: brand.accentColor })}">${escapeHtml(link.label)}</a></li>`;
    })
    .filter(Boolean)
    .join("");
  if (!items) return "";
  return `<ul>${items}</ul>`;
}

function style(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${toKebabCase(key)}: ${escapeAttribute(value)}`)
    .join("; ");
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function sanitizeGuidelines(guidelines: BrandGuidelines | undefined): Required<BrandGuidelines> {
  return {
    primaryColor: safeColor(guidelines?.primaryColor, DEFAULTS.primaryColor),
    secondaryColor: safeColor(guidelines?.secondaryColor, DEFAULTS.secondaryColor),
    accentColor: safeColor(guidelines?.accentColor, DEFAULTS.accentColor),
    textColor: safeColor(guidelines?.textColor, DEFAULTS.textColor),
    backgroundColor: safeColor(guidelines?.backgroundColor, DEFAULTS.backgroundColor),
    fontFamily: safeFontFamily(guidelines?.fontFamily, DEFAULTS.fontFamily),
  };
}

function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return SAFE_COLOR_PATTERN.test(trimmed) ? trimmed : fallback;
}

function safeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length <= 120 && SAFE_FONT_FAMILY_PATTERN.test(trimmed) ? trimmed : fallback;
}

function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;

  if (trimmed.startsWith("#") || trimmed.startsWith("/")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderPlainTextBody(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<div><p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p></div>`)
    .join("\n");
}

function tint(color: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return "#f7f7f7";
  }
  const hex = color.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgb(${Math.round(r + (255 - r) * 0.92)}, ${Math.round(g + (255 - g) * 0.92)}, ${Math.round(b + (255 - b) * 0.92)})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
