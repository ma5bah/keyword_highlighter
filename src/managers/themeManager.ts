import * as vscode from 'vscode';

// @CORE: Theme and contrast calculation engine ensuring legible highlights across color themes
// @TODO: Test and verify contrast calculation with hex3, hex6, hex8, rgb, rgba, and named colors
export class ThemeManager {
  private currentThemeKind: vscode.ColorThemeKind;

  constructor() {
    this.currentThemeKind = vscode.window.activeColorTheme.kind;
  }

  // @CORE: Update active theme tracking when the user switches VS Code themes
  // @TODO: Test and verify theme transitions between Light, Dark, and High Contrast
  public updateTheme(themeKind: vscode.ColorThemeKind): void {
    this.currentThemeKind = themeKind;
  }

  public get isHighContrast(): boolean {
    return (
      this.currentThemeKind === vscode.ColorThemeKind.HighContrast ||
      this.currentThemeKind === vscode.ColorThemeKind.HighContrastLight
    );
  }

  public get isDarkTheme(): boolean {
    return (
      this.currentThemeKind === vscode.ColorThemeKind.Dark ||
      this.currentThemeKind === vscode.ColorThemeKind.HighContrast
    );
  }

  // @CORE: Resolve adaptive foreground color based on background luminance and current theme
  // @TODO: Test and verify foreground selection against boundary luminances (0.4 - 0.5)
  public resolveForegroundColor(backgroundColor?: string, explicitColor?: string): string {
    if (explicitColor && explicitColor.toLowerCase() !== 'auto') {
      return explicitColor;
    }

    if (!backgroundColor) {
      return this.isDarkTheme ? '#FFFFFF' : '#1E1E1E';
    }

    const rgb = this.parseColorToRgb(backgroundColor);
    if (!rgb) {
      return this.isDarkTheme ? '#FFFFFF' : '#1E1E1E';
    }

    // WCAG relative luminance formula
    const [r, g, b] = rgb.map((c) => {
      const channel = c / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    return luminance > 0.45 ? '#1E1E1E' : '#FFFFFF';
  }

  // @CORE: Resolve outline/border fallbacks for High Contrast themes
  // @TODO: Test and verify border generation when high contrast is active
  public resolveBorder(borderColor?: string, backgroundColor?: string): string | undefined {
    if (borderColor) {
      return `1px solid ${borderColor}`;
    }

    if (this.isHighContrast) {
      return `1px solid ${this.isDarkTheme ? '#FFFFFF' : '#000000'}`;
    }

    return undefined;
  }

  // @CORE: Convert hex/named color to rgba string with custom alpha for non-intrusive diff and whole-line highlights
  // @TODO: Test and verify alpha blending over Git diff green/red line backgrounds
  public toRgbaString(color: string, alpha: number = 0.25): string {
    const rgb = this.parseColorToRgb(color);
    if (!rgb) {
      return color;
    }
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  // @CORE: Parse hexadecimal, rgb, and standard named colors into RGB tuples
  // @TODO: Test and verify malformed strings, alpha channels, and unsupported color syntax
  public parseColorToRgb(color: string): [number, number, number] | null {
    const trimmed = color.trim().toLowerCase();

    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return [r, g, b];
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return [r, g, b];
      }
    }

    const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
      return [
        Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10))),
        Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10))),
        Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10))),
      ];
    }

    const namedColors: Record<string, [number, number, number]> = {
      red: [255, 0, 0],
      green: [0, 128, 0],
      blue: [0, 0, 255],
      yellow: [255, 255, 0],
      black: [0, 0, 0],
      white: [255, 255, 255],
      gray: [128, 128, 128],
      orange: [255, 165, 0],
      purple: [128, 128, 128],
    };

    return namedColors[trimmed] || null;
  }
}
