const axios = require('axios');

async function diagnoseOTP() {
  console.log('='.repeat(60));
  console.log('OTP SYSTEM DIAGNOSIS');
  console.log('='.repeat(60));
  
  // Step 1: Check if backend is running
  console.log('\n[1] Checking backend status...');
  try {
    const healthCheck = await axios.get('http://localhost:3001/api/system/health');
    console.log('✅ Backend is running');
    console.log('   Status:', healthCheck.data.status);
  } catch (error) {
    console.log('❌ Backend is not accessible');
    console.log('   Error:', error.message);
    return;
  }
  
  // Step 2: Test forgot password endpoint
  console.log('\n[2] Testing forgot password endpoint...');
  const testEmail = 'prit.dharsandiya.dilipbhai@gmail.com';
  
  try {
    const response = await axios.post('http://localhost:3001/api/auth/forgot-password', {
      email: testEmail
    });
    
    console.log('✅ API Response received');
    console.log('   Message:', response.data.data.message);
    console.log('   Cooldown:', response.data.data.resendCooldownSeconds, 'seconds');
    console.log('   Retry after:', response.data.data.resendAvailableInSeconds, 'seconds');
    
  } catch (error) {
    console.log('❌ API Error');
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Error:', error.response.data);
    } else {
      console.log('   Error:', error.message);
    }
    return;
  }
  
  // Step 3: Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('✅ Backend is running');
  console.log('✅ Forgot password endpoint responds correctly');
  console.log('\n📋 Email Configuration Check:');
  console.log('   MAIL_ENABLED:', process.env.MAIL_ENABLED || 'true (from .env)');
  const transport = (process.env.MAIL_TRANSPORT || 'smtp').toLowerCase();
  console.log('   MAIL_TRANSPORT:', transport);
  if (transport === 'gmail') {
    console.log('   MAIL_GMAIL_USER:', process.env.MAIL_GMAIL_USER || '(from .env)');
    console.log(
      '   MAIL_GMAIL_APP_PASSWORD:',
      process.env.MAIL_GMAIL_APP_PASSWORD ? '✓ Set' : '✗ Not set',
    );
    console.log('   MAIL_GMAIL_FROM:', process.env.MAIL_GMAIL_FROM || '(optional)');
  } else {
    console.log('   MAIL_HOST:', process.env.MAIL_HOST || '(from .env)');
    console.log('   MAIL_PORT:', process.env.MAIL_PORT || '587');
    console.log('   MAIL_USER:', process.env.MAIL_USER || '(from .env)');
    console.log('   MAIL_PASSWORD:', process.env.MAIL_PASSWORD ? '✓ Set' : '✗ Not set');
  }
  console.log('   MAIL_FROM:', process.env.MAIL_FROM || 'prit.dharsandiya.dilipbhai@gmail.com');
  
  console.log('\n📧 Next Steps:');
  console.log('   1. Check your email inbox:', testEmail);
  console.log('   2. Look in spam/junk folder');
  console.log('   3. Review backend logs for email sending errors');
  
  console.log('\n💡 If no email arrives, check:');
  if (transport === 'gmail') {
    console.log('   - Gmail address is correct');
    console.log('   - Gmail App Password is generated and copied correctly');
    console.log('   - 2-Step Verification is enabled on Gmail account');
  } else {
    console.log('   - SMTP host/user/password are correct');
    console.log('   - Sender email is allowed by your SMTP provider');
    console.log('   - SMTP account is active');
  }
  console.log('   - Backend logs for delivery errors');
  
  console.log('\n' + '='.repeat(60));
}

diagnoseOTP().catch(console.error);
