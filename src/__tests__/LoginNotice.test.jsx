// "Your sign-in has expired" is shown on the login screen and cleared after signing in,
// never as a popup that appears only after the next login.
import { describe, it, expect, beforeEach } from 'vitest';
import { setLoginNotice, readLoginNotice, clearLoginNotice } from '../services/loginNotice';

describe('login notice', () => {
  beforeEach(() => sessionStorage.clear());

  it('is kept until the user signs in', () => {
    expect(readLoginNotice()).toBe('');
    setLoginNotice('Your sign-in has expired. Please sign in again.');
    expect(readLoginNotice()).toBe('Your sign-in has expired. Please sign in again.');
    clearLoginNotice();
    expect(readLoginNotice()).toBe('');
  });
});
