const axios = require('axios');

const sendEmail = async (options) => {
    // Check for API Key
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;

    if (!apiKey || !senderEmail) {
        throw new Error('BREVO_API_KEY or BREVO_SENDER_EMAIL is missing in environment variables.');
    }

    // Prepare payload for Brevo API (v3)
    const payload = {
        sender: {
            name: process.env.FROM_NAME || 'Pydah Fee Management',
            email: senderEmail
        },
        to: [
            {
                email: options.email
            }
        ],
        subject: options.subject,
        htmlContent: options.html || options.message // Use HTML if available, otherwise message as simple content
    };

    // If only text is provided and no HTML, wrap it in simple paragraph
    if (!options.html && options.message) {
        payload.htmlContent = `<p>${options.message.replace(/\n/g, '<br>')}</p>`;
    }

    try {
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            }
        });

        console.log(`Email sent to ${options.email}. MessageId: ${response.data.messageId}`);
        return response.data;
    } catch (error) {
        console.error('Brevo API Error:', error.response ? error.response.data : error.message);
        throw new Error(error.response?.data?.message || 'Failed to send email via Brevo');
    }
};

module.exports = sendEmail;
