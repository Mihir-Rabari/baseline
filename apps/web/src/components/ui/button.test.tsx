import React from 'react';
import Link from 'next/link';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button composition', () => {
  it('renders an ordinary button with styling, click handling and its ref', () => {
    const onClick = vi.fn();
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref} variant="outline" onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveClass('border-input');
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a disabled native button that cannot invoke its action', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('composes a Next Link without nesting a button or leaking asChild to the DOM', () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault());
    const { container } = render(
      <Button asChild variant="outline" onClick={onClick} aria-label="Enquire about Gold">
        <Link href="/contact?plan=GOLD">Enquire</Link>
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Enquire about Gold' });
    expect(link).toHaveAttribute('href', '/contact?plan=GOLD');
    expect(link).toHaveClass('border-input');
    expect(link).not.toHaveAttribute('aschild');
    expect(container.querySelector('button')).toBeNull();
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('preserves the child click handler when composing a link', () => {
    const childClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    const buttonClick = vi.fn();
    render(
      <Button asChild onClick={buttonClick}>
        <a href="/plans" onClick={childClick}>View plans</a>
      </Button>
    );
    fireEvent.click(screen.getByRole('link', { name: 'View plans' }));
    expect(childClick).toHaveBeenCalledOnce();
    expect(buttonClick).toHaveBeenCalledOnce();
  });
});
