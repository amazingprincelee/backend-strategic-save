import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      console.log('✅ Email service initialized');
    } catch (error) {
      console.error('❌ Email service initialization failed:', error.message);
    }
  }

  async verifyConnection() {
    try {
      if (!this.transporter) {
        throw new Error('Email transporter not initialized');
      }
      
      await this.transporter.verify();
      console.log('✅ Email service connection verified');
      return true;
    } catch (error) {
      console.error('❌ Email service verification failed:', error.message);
      return false;
    }
  }

  async sendEmail(to, subject, html, text = null) {
    try {
      if (!this.transporter) {
        throw new Error('Email transporter not initialized');
      }

      const mailOptions = {
        from: `"SmartStrategy" <${process.env.EMAIL_FROM}>`,
        to,
        subject,
        html,
        text: text || this.stripHtml(html)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent to ${to}: ${subject}`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message);
      throw error;
    }
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  // Email verification
  async sendEmailVerification(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - SmartStrategy</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #06B6D4, #0b2447); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #06B6D4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to SmartStrategy!</h1>
          </div>
          <div class="content">
            <h2>Verify Your Email Address</h2>
            <p>Hello ${user.fullName || 'there'},</p>
            <p>Thank you for joining SmartStrategy! To complete your registration and start creating secure savings vaults, please verify your email address.</p>
            <p>Click the button below to verify your email:</p>
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #06B6D4;">${verificationUrl}</p>
            <p><strong>This verification link will expire in 24 hours.</strong></p>
            <p>If you didn't create an account with SmartStrategy, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© 2024 SmartStrategy. All rights reserved.</p>
            <p>Secure your crypto savings with time-locked vaults.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      'Verify Your Email - SmartStrategy',
      html
    );
  }

  // Password reset
  async sendPasswordReset(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password - SmartStrategy</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #06B6D4, #0b2447); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #06B6D4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Reset Your Password</h2>
            <p>Hello ${user.fullName || 'there'},</p>
            <p>We received a request to reset your password for your SmartStrategy account.</p>
            <p>Click the button below to reset your password:</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #06B6D4;">${resetUrl}</p>
            <div class="warning">
              <strong>⚠️ Important:</strong>
              <ul>
                <li>This reset link will expire in 10 minutes</li>
                <li>If you didn't request this reset, please ignore this email</li>
                <li>Your password will remain unchanged until you create a new one</li>
              </ul>
            </div>
          </div>
          <div class="footer">
            <p>© 2024 SmartStrategy. All rights reserved.</p>
            <p>Keep your crypto savings secure.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      'Reset Your Password - SmartStrategy',
      html
    );
  }

  // Vault maturity notification
  async sendVaultMaturityNotification(user, vault) {
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Vault Matured - SmartStrategy</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #06B6D4, #0b2447); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .vault-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #06B6D4; }
          .button { display: inline-block; background: #06B6D4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Your Vault is Ready!</h1>
          </div>
          <div class="content">
            <h2>Vault Maturity Notification</h2>
            <p>Hello ${user.fullName || 'there'},</p>
            <p>Great news! Your savings vault has reached maturity and is now available for withdrawal.</p>
            
            <div class="vault-info">
              <h3>Vault Details:</h3>
              <p><strong>Vault ID:</strong> #${vault.vaultId}</p>
              <p><strong>Token:</strong> ${vault.tokenSymbol}</p>
              <p><strong>Balance:</strong> ${vault.balance} ${vault.tokenSymbol}</p>
              <p><strong>Unlocked On:</strong> ${new Date(vault.unlockTime).toLocaleDateString()}</p>
            </div>
            
            <p>You can now withdraw your funds from this vault. Visit your dashboard to complete the withdrawal:</p>
            <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
            
            <p><strong>Note:</strong> Your funds will remain secure in the vault until you choose to withdraw them.</p>
          </div>
          <div class="footer">
            <p>© 2024 SmartStrategy. All rights reserved.</p>
            <p>Your crypto savings, secured with time.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      `🎉 Vault #${vault.vaultId} is Ready for Withdrawal - SmartStrategy`,
      html
    );
  }

  // Deposit confirmation
  async sendDepositConfirmation(user, vault, depositAmount, transactionHash) {
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;
    const explorerUrl = `https://sepolia.etherscan.io/tx/${transactionHash}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Deposit Confirmed - SmartStrategy</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #06B6D4, #0b2447); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .deposit-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
          .button { display: inline-block; background: #06B6D4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Deposit Confirmed!</h1>
          </div>
          <div class="content">
            <h2>Your Deposit is Secure</h2>
            <p>Hello ${user.fullName || 'there'},</p>
            <p>Your deposit has been successfully confirmed and added to your vault.</p>
            
            <div class="deposit-info">
              <h3>Deposit Details:</h3>
              <p><strong>Vault ID:</strong> #${vault.vaultId}</p>
              <p><strong>Amount:</strong> ${depositAmount} ${vault.tokenSymbol}</p>
              <p><strong>Token:</strong> ${vault.tokenSymbol}</p>
              <p><strong>Unlock Date:</strong> ${new Date(vault.unlockTime).toLocaleDateString()}</p>
              <p><strong>Transaction:</strong> <a href="${explorerUrl}" style="color: #06B6D4;">${transactionHash.substring(0, 20)}...</a></p>
            </div>
            
            <p>Your funds are now securely locked in the vault until the unlock date. You can track your vault's progress on your dashboard:</p>
            <a href="${dashboardUrl}" class="button">View Dashboard</a>
            <a href="${explorerUrl}" class="button" style="background: #10b981;">View Transaction</a>
          </div>
          <div class="footer">
            <p>© 2024 SmartStrategy. All rights reserved.</p>
            <p>Building your financial future, one vault at a time.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      `✅ Deposit Confirmed for Vault #${vault.vaultId} - SmartStrategy`,
      html
    );
  }

  // Arbitrage alert — sent to all users when ≥2% opportunities are detected
  // @param {Array} users         - User documents with .email and .fullName
  // @param {Array} opportunities - ArbitrageOpportunity objects (new, ≥2% profit)
  async sendArbitrageAlert(users, opportunities) {
    if (!users.length || !opportunities.length) return { sent: 0, failed: 0 };

    const arbitrageUrl = `${process.env.FRONTEND_URL}/arbitrage`;

    const rows = opportunities
      .slice(0, 5)
      .map(o => `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;font-weight:600;color:#111827;">${o.symbol}</td>
          <td style="padding:10px 8px;text-align:center;">
            <span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:999px;font-size:12px;">${o.buyExchange}</span>
          </td>
          <td style="padding:10px 8px;text-align:center;">
            <span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:999px;font-size:12px;">${o.sellExchange}</span>
          </td>
          <td style="padding:10px 8px;text-align:right;font-weight:700;color:#16a34a;font-size:15px;">
            ${o.netProfitPercent.toFixed(2)}%
          </td>
          <td style="padding:10px 8px;text-align:right;color:#16a34a;">
            $${(o.expectedProfitUSD || 0).toFixed(2)}
          </td>
          <td style="padding:10px 8px;text-align:center;">
            <span style="background:${o.riskLevel === 'Low' ? '#dcfce7' : o.riskLevel === 'Medium' ? '#fef9c3' : '#fee2e2'};
                         color:${o.riskLevel === 'Low' ? '#15803d' : o.riskLevel === 'Medium' ? '#a16207' : '#b91c1c'};
                         padding:2px 8px;border-radius:999px;font-size:12px;">
              ${o.riskLevel || 'Medium'}
            </span>
          </td>
        </tr>
      `)
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
      <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;background:#f3f4f6;">
        <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
          <div style="background:linear-gradient(135deg,#06B6D4,#0b2447);color:white;padding:30px;text-align:center;border-radius:12px 12px 0 0;">
            <div style="font-size:32px;margin-bottom:8px;">📈</div>
            <h1 style="margin:0;font-size:22px;">High-Profit Arbitrage Alert!</h1>
            <p style="margin:8px 0 0;opacity:.85;font-size:14px;">
              ${opportunities.length} opportunit${opportunities.length === 1 ? 'y' : 'ies'} above 2% net profit detected
            </p>
          </div>
          <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 4px 12px rgba(0,0,0,.07);">
            <p style="margin:0 0 16px;">Hello,</p>
            <p style="margin:0 0 20px;color:#4b5563;">
              Our scanner just detected <strong>${opportunities.length} arbitrage opportunit${opportunities.length === 1 ? 'y' : 'ies'}</strong>
              with a <strong style="color:#16a34a;">net profit above 2%</strong> after all fees and slippage.
              These windows close fast — act quickly.
            </p>
            <div style="overflow-x:auto;margin-bottom:24px;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                    <th style="padding:10px 8px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:11px;">Pair</th>
                    <th style="padding:10px 8px;text-align:center;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:11px;">Buy On</th>
                    <th style="padding:10px 8px;text-align:center;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:11px;">Sell On</th>
                    <th style="padding:10px 8px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:11px;">Net Profit</th>
                    <th style="padding:10px 8px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:11px;">Expected $</th>
                    <th style="padding:10px 8px;text-align:center;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:11px;">Risk</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <div style="text-align:center;margin:24px 0;">
              <a href="${arbitrageUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#06B6D4,#0284c7);color:white;
                        padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">
                View Live Opportunities →
              </a>
            </div>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:16px;">
              <p style="margin:0;font-size:12px;color:#92400e;">
                <strong>⚠ Risk Disclaimer:</strong> Arbitrage profits are not guaranteed. Prices can change
                between detection and execution. Always verify before trading.
              </p>
            </div>
          </div>
          <div style="text-align:center;margin-top:20px;color:#9ca3af;font-size:12px;">
            <p>© ${new Date().getFullYear()} SmartStrategy. You received this because you have an active account.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const results = await Promise.allSettled(
      users.map(u =>
        this.sendEmail(
          u.email,
          `📈 Arbitrage Alert: ${opportunities.length} opportunit${opportunities.length === 1 ? 'y' : 'ies'} above 2% profit — SmartStrategy`,
          html
        )
      )
    );

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`[ArbitrageAlert] Emails sent: ${sent}, failed: ${failed}`);
    return { sent, failed };
  }

  // Withdrawal confirmation
  async sendWithdrawalConfirmation(user, vault, withdrawalAmount, platformFee, transactionHash) {
    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;
    const explorerUrl = `https://sepolia.etherscan.io/tx/${transactionHash}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Withdrawal Completed - SmartStrategy</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #06B6D4, #0b2447); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .withdrawal-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
          .button { display: inline-block; background: #06B6D4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💰 Withdrawal Completed!</h1>
          </div>
          <div class="content">
            <h2>Your Funds Have Been Withdrawn</h2>
            <p>Hello ${user.fullName || 'there'},</p>
            <p>Your withdrawal has been successfully processed and the funds have been sent to your wallet.</p>
            
            <div class="withdrawal-info">
              <h3>Withdrawal Details:</h3>
              <p><strong>Vault ID:</strong> #${vault.vaultId}</p>
              <p><strong>Gross Amount:</strong> ${withdrawalAmount} ${vault.tokenSymbol}</p>
              <p><strong>Platform Fee:</strong> ${platformFee} ${vault.tokenSymbol}</p>
              <p><strong>Net Amount:</strong> ${(parseFloat(withdrawalAmount) - parseFloat(platformFee)).toFixed(6)} ${vault.tokenSymbol}</p>
              <p><strong>Transaction:</strong> <a href="${explorerUrl}" style="color: #06B6D4;">${transactionHash.substring(0, 20)}...</a></p>
            </div>
            
            <p>Thank you for using SmartStrategy! You can create new vaults anytime to continue building your savings strategy:</p>
            <a href="${dashboardUrl}" class="button">Create New Vault</a>
            <a href="${explorerUrl}" class="button" style="background: #f59e0b;">View Transaction</a>
          </div>
          <div class="footer">
            <p>© 2024 SmartStrategy. All rights reserved.</p>
            <p>Congratulations on reaching your savings goal!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      `💰 Withdrawal Completed for Vault #${vault.vaultId} - SmartStrategy`,
      html
    );
  }
}

// Create singleton instance
const emailService = new EmailService();

export default emailService;