import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Spinner, PageSpinner } from './spinner';
import { Button } from './button';
import { ThemeToggle } from './theme-toggle';
const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => theme }));
describe('Accessible shared icons', () => {
  it('uses a consistent Lucide glyph and announces a standalone progress label once', () => {
    render(<Spinner label="Saving" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saving');
    const icon = status.querySelector('svg')!;
    expect(icon).toHaveClass('lucide-loader-circle', 'h-4', 'w-4');
    expect(icon).toHaveAttribute('stroke-width', '2'); expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
  it('keeps busy buttons named and disabled while hiding their loading glyph', () => {
    const click = vi.fn(); render(<Button loading onClick={click}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button); expect(click).not.toHaveBeenCalled();
  });
  it('uses named content placeholders for page loading rather than a custom SVG', () => {
    render(<PageSpinner label="Checking your link" />);
    expect(screen.getByRole('status', { name: 'Checking your link' })).toBeVisible();
    expect(screen.getByRole('status').querySelector('svg')).toBeNull();
  });
  it('keeps both theme glyphs decorative and gives the control a single name', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Toggle theme' });
    expect(button.querySelectorAll('svg')).toHaveLength(2);
    for (const icon of button.querySelectorAll('svg')) { expect(icon).toHaveAttribute('aria-hidden', 'true'); expect(icon).toHaveAttribute('stroke-width', '2'); expect(icon).toHaveClass('h-4', 'w-4'); }
  });
});
