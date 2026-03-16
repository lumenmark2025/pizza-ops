import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orderId, amount, description } = req.body ?? {};

    if (!orderId || !amount || !description) {
      return res.status(400).json({ error: "Missing orderId, amount, or description" });
    }

    const apiKey = process.env.SUMUP_API_KEY;
    const merchantCode = process.env.SUMUP_MERCHANT_CODE;
    const apiUrl = process.env.SUMUP_API_URL || "https://api.sumup.com";
    const redirectBaseUrl = process.env.SUMUP_REDIRECT_BASE_URL;

    if (!apiKey || !merchantCode || !redirectBaseUrl) {
      return res.status(500).json({ error: "Missing SumUp server environment variables" });
    }

    const redirectUrl = `${redirectBaseUrl}/order/confirmation/${orderId}`;

    const payload = {
      amount: Number(amount),
      currency: "GBP",
      checkout_reference: String(orderId),
      description: String(description),
      merchant_code: merchantCode,
      redirect_url: redirectUrl,
      hosted_checkout: {
        enabled: true,
      },
    };

    const response = await fetch(`${apiUrl}/v0.1/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "SumUp checkout creation failed",
        details: data,
      });
    }

    return res.status(200).json({
      checkoutId: data.id,
      hostedCheckoutUrl: data.hosted_checkout_url,
      status: data.status,
      raw: data,
    });
  } catch (error) {
    console.error("create-sumup-checkout error", error);
    return res.status(500).json({
      error: "Unexpected server error",
    });
  }
}
