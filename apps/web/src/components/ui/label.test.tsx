import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Label } from './label';
import { Input } from './input';

const MARK = "after:content-['*']";

describe('Label required mark', () => {
  it('marks a label whose control is required', async () => {
    render(<><Label htmlFor="a">Name</Label><Input id="a" required /></>);
    expect((await screen.findByText('Name')).className).toContain(MARK);
  });
  it('marks a label whose control is aria-required', async () => {
    render(<><Label htmlFor="b">Phone</Label><Input id="b" aria-required="true" /></>);
    expect((await screen.findByText('Phone')).className).toContain(MARK);
  });
  it('leaves optional fields unmarked and keeps the label text unchanged', () => {
    render(<><Label htmlFor="c">Notes</Label><Input id="c" /></>);
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(screen.getByText('Notes').className).not.toContain(MARK);
  });
  it('honours an explicit required prop', () => {
    render(<Label required>Actions</Label>);
    expect(screen.getByText('Actions').className).toContain(MARK);
  });
});
