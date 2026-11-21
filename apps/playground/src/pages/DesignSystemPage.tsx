import tokens from '@ds/tokens/tokens.json';

const typedTokens = tokens as Record<string, any>;

function ColorSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="w-full h-12 border rounded-md shadow-sm border-border-default"
        style={{ backgroundColor: value }}
      />
      <div>
        <p className="text-xs font-medium text-text-default">{name}</p>
        <p className="font-mono text-xs text-text-muted">{value}</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="pb-2 border-b text-text-default border-border-default">
        {title}
      </h2>
      {children}
    </section>
  );
}

function renderColorGroup(name: string, group: Record<string, any>) {
  const shades: Record<string, string> = {};
  Object.entries(group).forEach(([key, value]) => {
    if (typeof value === 'string') shades[key] = value;
  });

  if (Object.keys(shades).length === 0) return null;

  return (
    <div key={name} className="mb-8">
      <h3 className="mb-3 tracking-wide uppercase text-text-muted">{name}</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {Object.entries(shades).map(([shade, value]) => (
          <ColorSwatch key={shade} name={`${name}.${shade}`} value={value} />
        ))}
      </div>
    </div>
  );
}

interface TypographyStyle {
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing?: string;
  textTransform?: string;
  fontFamily?: string;
}

function isTypographyStyle(value: unknown): value is TypographyStyle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fontSize' in value &&
    'fontWeight' in value &&
    'lineHeight' in value
  );
}

function TypographySample({ name, style }: { name: string; style: TypographyStyle }) {
  return (
    <div className="flex flex-col gap-2 pb-4 border-b border-border-default last:border-0">
      <div className="flex items-baseline gap-4">
        <span className="w-24 font-mono text-xs uppercase text-text-muted">{name}</span>
        <span
          className="flex-1"
          style={{
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            textTransform: style.textTransform,
            fontFamily: style.fontFamily ?? 'var(--typography-fontfamily-sans)',
          }}
        >
          The quick brown fox jumps over the lazy dog
        </span>
      </div>
      <div className="pl-28 font-mono text-xs text-text-muted">
        {style.fontSize} / {style.fontWeight} / {style.lineHeight}
        {style.letterSpacing ? ` / ${style.letterSpacing}` : ''}
      </div>
    </div>
  );
}

function renderTypographyGroup(group: Record<string, any>) {
  const samples: React.ReactNode[] = [];

  Object.entries(group).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isTypographyStyle(item)) {
          samples.push(<TypographySample key={`${name}-${index}`} name={`${name}[${index}]`} style={item} />);
        }
      });
    } else if (isTypographyStyle(value)) {
      samples.push(<TypographySample key={name} name={name} style={value} />);
    }
  });

  return samples;
}

export function DesignSystemPage() {
  const { color, spacing, typography, radius, shadow } = typedTokens;

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-text-default">Design System</h1>
        <p className="mt-1 text-text-muted">
          Source: <code className="font-mono text-sm">packages/tokens/tokens.json</code>
        </p>
      </div>

      <Section title="Colors">
        {Object.entries(color).map(([groupName, groupValue]) => {
          if (typeof groupValue !== 'object' || groupValue === null) return null;
          return renderColorGroup(groupName, groupValue as Record<string, any>);
        })}
      </Section>

      <Section title="Spacing">
        <div className="space-y-2">
          {Object.entries(spacing).map(([scale, value]) => (
            <div key={scale} className="flex items-center gap-4">
              <span className="w-8 font-mono text-sm text-text-muted">{scale}</span>
              <div
                className="h-4 rounded opacity-70 bg-action-primary-default"
                style={{ width: value as string }}
              />
              <span className="font-mono text-sm text-text-muted">{value as string}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography — Font Families">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Object.entries(typography.fontFamily).map(([name, value]) => (
            <div key={name} className="p-4 rounded-lg border border-border-default bg-surface-primary">
              <p className="text-xs font-medium uppercase text-text-muted mb-2">{name}</p>
              <p className="font-mono text-sm text-text-default">
                {Array.isArray(value) ? value.join(', ') : (value as string)}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography — Display">{renderTypographyGroup(typography.display)}</Section>
      <Section title="Typography — Heading">{renderTypographyGroup(typography.heading)}</Section>
      <Section title="Typography — Paragraph">{renderTypographyGroup(typography.paragraph)}</Section>
      <Section title="Typography — Small Caps">{renderTypographyGroup(typography.smallCaps)}</Section>
      <Section title="Typography — Button">{renderTypographyGroup(typography.button)}</Section>
      <Section title="Typography — Link">{renderTypographyGroup(typography.link)}</Section>

      <Section title="Radius">
        <div className="flex flex-wrap gap-4">
          {Object.entries(radius).map(([name, value]) => (
            <div
              key={name}
              className="flex items-center justify-center w-24 h-24 border border-border-default bg-surface-secondary"
              style={{ borderRadius: value as string }}
            >
              <span className="text-xs text-text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shadow">
        <div className="flex flex-wrap gap-6">
          {Object.entries(shadow).map(([name, value]) => (
            <div
              key={name}
              className="flex flex-col items-center justify-center w-32 h-32 gap-2 rounded-lg bg-surface-primary"
              style={{ boxShadow: value as string }}
            >
              <span className="text-sm font-medium text-text-default">{name}</span>
              <span className="text-xs text-text-muted">{value as string}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
