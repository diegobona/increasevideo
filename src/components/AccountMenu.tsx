export default function AccountMenu({ email }: { email: string }) {
  return (
    <div className="account-menu">
      <button type="button" className="account-trigger" popoverTarget="account-panel" aria-label="Account" title="Account">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 20c.6-4 3.4-6 7.5-6s6.9 2 7.5 6" />
        </svg>
        <span>Account</span>
      </button>
      <div id="account-panel" className="account-panel" popover="auto">
        <p>Signed in as <strong>{email}</strong></p>
        <form action="/auth/signout" method="post">
          <button type="submit">Sign out</button>
        </form>
      </div>
    </div>
  );
}
