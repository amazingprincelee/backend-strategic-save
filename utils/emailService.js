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
        from: `"Strategic Crypto Save" <${process.env.EMAIL_FROM}>`,
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
        <title>Verify Your Email - Strategic Crypto Save</title>
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
            <h1>Welcome to Strategic Crypto Save!</h1>
          </div>
          <div class="content">
            <h2>Verify Your Email Address</h2>
            <p>Hello ${user.fullName || 'there'},</p>
            <p>Thank you for joining Strategic Crypto Save! To complete your registration and start creating secure savings vaults, please verify your email address.</p>
            <p>Click the button below to verify your email:</p>
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #06B6D4;">${verificationUrl}</p>
            <p><strong>This verification link will expire in 24 hours.</strong></p>
            <p>If you didn't create an account with Strategic Crypto Save, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© 2024 Strategic Crypto Save. All rights reserved.</p>
            <p>Secure your crypto savings with time-locked vaults.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      'Verify Your Email - Strategic Crypto Save',
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
        <title>Reset Your Password - Strategic Crypto Save</title>
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
            <p>We received a request to reset your password for your Strategic Crypto Save account.</p>
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
            <p>© 2024 Strategic Crypto Save. All rights reserved.</p>
            <p>Keep your crypto savings secure.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      'Reset Your Password - Strategic Crypto Save',
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
        <title>Vault Matured - Strategic Crypto Save</title>
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
            <p>© 2024 Strategic Crypto Save. All rights reserved.</p>
            <p>Your crypto savings, secured with time.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      `🎉 Vault #${vault.vaultId} is Ready for Withdrawal - Strategic Crypto Save`,
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
        <title>Deposit Confirmed - Strategic Crypto Save</title>
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
            <p>© 2024 Strategic Crypto Save. All rights reserved.</p>
            <p>Building your financial future, one vault at a time.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      `✅ Deposit Confirmed for Vault #${vault.vaultId} - Strategic Crypto Save`,
      html
    );
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
        <title>Withdrawal Completed - Strategic Crypto Save</title>
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
            
            <p>Thank you for using Strategic Crypto Save! You can create new vaults anytime to continue building your savings strategy:</p>
            <a href="${dashboardUrl}" class="button">Create New Vault</a>
            <a href="${explorerUrl}" class="button" style="background: #f59e0b;">View Transaction</a>
          </div>
          <div class="footer">
            <p>© 2024 Strategic Crypto Save. All rights reserved.</p>
            <p>Congratulations on reaching your savings goal!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(
      user.email,
      `💰 Withdrawal Completed for Vault #${vault.vaultId} - Strategic Crypto Save`,
      html
    );
  }
}

// Create singleton instance
const emailService = new EmailService();

export default emailService;