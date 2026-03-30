import nodemailer from "nodemailer";

function createTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

export async function sendInviteEmail(opts: {
  to: string;
  name: string;
  role: string;
  activationLink: string;
  invitedBy: string;
}): Promise<{ sent: boolean; note: string }> {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || "noreply@kidspot.app";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#7C3AED;">Convite para o Backoffice KidSpot</h2>
      <p>Olá, <strong>${opts.name}</strong>!</p>
      <p><strong>${opts.invitedBy}</strong> te convidou para colaborar no backoffice do KidSpot com o perfil <strong>${opts.role}</strong>.</p>
      <p>Clique no botão abaixo para ativar sua conta (link válido por <strong>72 horas</strong>):</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${opts.activationLink}"
           style="background:#7C3AED;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Ativar minha conta
        </a>
      </p>
      <p style="color:#6B7280;font-size:13px;">Se você não esperava este convite, ignore este e-mail.</p>
    </div>
  `;

  if (!transporter) {
    console.info(
      `[KidSpot Email – dev mode] Invite to ${opts.to} (${opts.role}):\n  ${opts.activationLink}`,
    );
    return {
      sent: false,
      note: "SMTP não configurado. O link de ativação está disponível na resposta da API.",
    };
  }

  await transporter.sendMail({
    from,
    to: opts.to,
    subject: "Você foi convidado para o Backoffice KidSpot",
    html,
  });

  return { sent: true, note: `E-mail de convite enviado para ${opts.to}.` };
}
