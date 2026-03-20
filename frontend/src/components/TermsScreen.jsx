import { useState } from 'react'

export default function TermsScreen({ onAccept }) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [checked, setChecked] = useState(false)

  function handleScroll(e) {
    const el = e.target
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) {
      setScrolledToBottom(true)
    }
  }

  function handleAccept() {
    if (!checked) return
    localStorage.setItem('pilot_terms_accepted', new Date().toISOString())
    onAccept()
  }

  return (
    <div className="login-screen">
      <div className="terms-card">
        <img src="/favicon.svg" alt="Pilot" className="login-logo" />
        <div className="login-title">Terms of Use</div>
        <div className="login-subtitle">Please review before continuing</div>

        <div className="terms-scroll" onScroll={handleScroll}>
          <h3>Pilot Terms of Use</h3>
          <p><em>Last updated: March 20, 2026</em></p>

          <h4>1. What Pilot Is</h4>
          <p>Pilot is a user interface for Claude Code, a product of Anthropic. Pilot is not affiliated with, endorsed by, or a product of Anthropic. Pilot provides a conversational interface that sends your instructions to Claude Code, which then executes commands on your computer.</p>

          <h4>2. Automatic Command Execution</h4>
          <p><strong>IMPORTANT: Pilot runs Claude Code in automatic execution mode.</strong> This means Claude Code will read, create, modify, and delete files, install packages, run scripts, and execute terminal commands on your computer <strong>without asking for individual approval</strong>. By using Pilot, you understand and accept that commands will be executed automatically on your behalf.</p>

          <h4>3. Use at Your Own Risk</h4>
          <p>Pilot is provided "as is" without warranty of any kind, express or implied. You use Pilot entirely at your own risk. The developer(s) of Pilot are not responsible for:</p>
          <ul>
            <li>Data loss, file deletion, or corruption</li>
            <li>Unintended modifications to your system, files, or configurations</li>
            <li>Security vulnerabilities introduced by executed commands</li>
            <li>Any damages, direct or indirect, arising from use of Pilot</li>
            <li>Actions taken by Claude Code in response to your instructions</li>
            <li>Costs incurred from third-party services or APIs invoked during use</li>
          </ul>

          <h4>4. Your Responsibilities</h4>
          <p>As a user of Pilot, you are responsible for:</p>
          <ul>
            <li>Maintaining backups of important data before using Pilot</li>
            <li>Reviewing the output and actions taken by Claude through Pilot</li>
            <li>Ensuring your use complies with Anthropic's terms of service for Claude</li>
            <li>Maintaining a valid Claude Pro or Max subscription</li>
            <li>Securing your remote access credentials if remote access is enabled</li>
            <li>Any commands executed on your computer through Pilot</li>
          </ul>

          <h4>5. Remote Access</h4>
          <p>If you enable remote access, your Pilot instance becomes accessible over the internet. You are responsible for keeping your password secure. The developer(s) of Pilot are not responsible for unauthorized access to your system resulting from compromised credentials or misconfigured remote access.</p>

          <h4>6. Account and Data</h4>
          <p>Your account information (name and email) is collected for service operation and communication purposes. Session data is stored locally on your machine. We do not sell your personal information to third parties.</p>

          <h4>7. No Guarantee of Availability</h4>
          <p>Pilot depends on Claude Code and your Claude subscription. Service availability is not guaranteed. Features may change, be deprecated, or stop working if underlying dependencies change.</p>

          <h4>8. Limitation of Liability</h4>
          <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE DEVELOPER(S) OF PILOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF OR INABILITY TO USE PILOT.</p>

          <h4>9. Indemnification</h4>
          <p>You agree to indemnify and hold harmless the developer(s) of Pilot from any claims, damages, losses, or expenses arising from your use of Pilot or violation of these terms.</p>

          <h4>10. Changes to Terms</h4>
          <p>These terms may be updated from time to time. Continued use of Pilot after changes constitutes acceptance of the updated terms.</p>
        </div>

        <label className="terms-checkbox">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
          <span>I have read and agree to the Terms of Use. I understand that Pilot executes commands automatically on my computer and I use it at my own risk.</span>
        </label>

        <button className="login-btn" onClick={handleAccept} disabled={!checked || !scrolledToBottom}>
          {!scrolledToBottom ? 'Read to continue' : 'Accept & Continue'}
        </button>
      </div>
    </div>
  )
}
