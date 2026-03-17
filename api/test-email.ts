import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Resend } from 'resend'

const TEST_TO_FALLBACK = 'ops@example.com'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    })
  }

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    return res.status(500).json({
      success: false,
      message: 'Missing RESEND_API_KEY',
    })
  }

  const resend = new Resend(resendApiKey)
  const requestedTo =
    typeof req.query.to === 'string'
      ? req.query.to
      : typeof req.body?.to === 'string'
        ? req.body.to
        : process.env.TEST_EMAIL_TO || TEST_TO_FALLBACK

  try {
    // Temporary internal-only pipeline test endpoint.
    const result = await resend.emails.send({
      from: 'North West Pizza <orders@pizza.northwestpizza.co.uk>',
      to: [requestedTo],
      subject: 'Pizza Ops Test Email',
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;">
          <h1 style="margin:0 0 12px;">Pizza Ops Test Email</h1>
          <p style="margin:0;">This confirms Resend is working from Pizza Ops.</p>
        </div>
      `,
    })

    if (result.error) {
      console.error('test-email resend error', result.error)
      return res.status(500).json({
        success: false,
        message: result.error.message || 'Resend email send failed',
      })
    }

    console.info('test-email resend success', { id: result.data?.id, to: requestedTo })
    return res.status(200).json({
      success: true,
      message: `Test email sent to ${requestedTo}`,
      id: result.data?.id ?? null,
    })
  } catch (error) {
    console.error('test-email unexpected error', error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unexpected test email error',
    })
  }
}
