const templateBase = (titulo, contenido) => `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f8; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .header { background-color: #2ecc71; color: white; padding: 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 30px; color: #333333; line-height: 1.6; }
        .footer { background-color: #f4f6f8; color: #7f8c8d; text-align: center; padding: 15px; font-size: 12px; border-top: 1px solid #e0e0e0; }
        .btn { display: inline-block; padding: 12px 25px; color: #ffffff !important; background-color: #2ecc71; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; margin-bottom: 20px; }
        .highlight { color: #e74c3c; font-weight: bold; }
        .logo-img { max-height: 60px; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="${process.env.FRONTEND_URL || 'https://groupwallettweb.onrender.com'}/Placeholders/LogoCorreo.png" alt="GroupWallet Logo" class="logo-img">
            <h1>${titulo}</h1>
        </div>
        <div class="content">
            ${contenido}
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} GroupWallet. Todos los derechos reservados.</p>
            <p>Si no solicitaste este correo, por favor ignóralo o contáctanos.</p>
        </div>
    </div>
</body>
</html>
`;

class EmailTemplates {
    static bienvenida(nombre) {
        const contenido = `
            <h2>¡Hola ${nombre}!</h2>
            <p>Bienvenido/a a <strong>GroupWallet</strong>, tu nueva herramienta para gestionar finanzas compartidas sin complicaciones.</p>
            <p>Estamos muy felices de que te unas a nuestra comunidad. Con GroupWallet podrás:</p>
            <ul style="list-style: none; padding: 0;">
                <li style="margin-bottom: 10px;">✅ Crear grupos y dividir gastos equitativamente.</li>
                <li style="margin-bottom: 10px;">✅ Registrar tus compras y mantener un historial claro.</li>
                <li>✅ Calcular automáticamente quién le debe a quién.</li>
            </ul>
            <div style="text-align: center; margin-top: 30px;">
                <a href="${process.env.FRONTEND_URL || 'https://groupwallettweb.onrender.com'}/dashboard.html" class="btn">Ir a mi Dashboard</a>
            </div>
            <p style="margin-top: 20px;">Si tienes alguna pregunta, no dudes en contactarnos.</p>
            <p>¡Que disfrutes la experiencia!</p>
        `;
        return templateBase('¡Bienvenido a GroupWallet!', contenido);
    }

    static invitacionGrupo(nombreInvitador, nombreGrupo, enlace) {
        const contenido = `
            <h2>¡Has sido invitado/a!</h2>
            <p><strong>${nombreInvitador}</strong> te ha invitado a unirte a su grupo financiero <strong>"${nombreGrupo}"</strong> en GroupWallet.</p>
            <p>Para aceptar la invitación y sumarte al grupo, haz clic en el siguiente botón:</p>
            <div style="text-align: center; margin-top: 30px;">
                <a href="${enlace}" class="btn">Unirme al Grupo</a>
            </div>
            <p style="font-size: 0.9rem; color: #7f8c8d;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
            <p style="font-size: 0.8rem; color: #34495e; word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px;">${enlace}</p>
            <p style="margin-top: 20px;">Si no conoces a esta persona o no deseas unirte, puedes ignorar este correo de forma segura.</p>
        `;
        return templateBase('Invitación de Grupo', contenido);
    }

    static recuperacionPassword(recoveryLink) {
        const contenido = `
            <h2>Hola,</h2>
            <p>Has solicitado restablecer tu contraseña en <strong>GroupWallet</strong>.</p>
            <p>Haz clic en el botón de abajo para crear tu nueva contraseña. Por seguridad, este enlace es válido únicamente por 15 minutos.</p>
            <div style="text-align: center;">
                <a href="${recoveryLink}" class="btn">Restablecer Contraseña</a>
            </div>
            <p style="font-size: 0.9rem; color: #7f8c8d;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
            <p style="font-size: 0.8rem; color: #34495e; word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px;">${recoveryLink}</p>
        `;
        return templateBase('Recuperación de Cuenta', contenido);
    }

    static resumenMensual(nombre, total_gastado, total_hormiga, tip) {
        const contenido = `
            <h2>Hola ${nombre},</h2>
            <p>Aquí tienes tu resumen mensual de finanzas en <strong>GroupWallet</strong>:</p>
            <ul style="list-style: none; padding: 0;">
                <li style="margin-bottom: 10px;">💰 <strong>Total Gastado:</strong> $${total_gastado}</li>
                <li>🐜 <strong>Gastos Hormiga (menores a $15):</strong> $${total_hormiga}</li>
            </ul>
            <div style="background-color: #e8f8f5; border-left: 4px solid #2ecc71; padding: 15px; margin-top: 20px; border-radius: 0 4px 4px 0;">
                <strong>💡 Nuestro Tip:</strong><br>
                ${tip}
            </div>
        `;
        return templateBase('Tu Resumen Mensual', contenido);
    }

    static recordatorioDeudas(nombre, cantidad_cuotas, deuda_total) {
        const contenido = `
            <h2>Hola ${nombre},</h2>
            <p>Este es un recordatorio amigable de que actualmente tienes <strong class="highlight">${cantidad_cuotas} cuota(s) pendiente(s)</strong> en tus grupos.</p>
            <div style="text-align: center; background-color: #fdf2e9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 1.1rem; color: #e67e22;">Deuda Total Estimada</p>
                <h3 style="margin: 5px 0 0 0; color: #d35400; font-size: 24px;">$${parseFloat(deuda_total).toFixed(2)}</h3>
            </div>
            <p>Ingresa a la aplicación para revisar el detalle y saldar tus deudas. ¡Mantén tus finanzas al día!</p>
            <div style="text-align: center;">
                <a href="${process.env.FRONTEND_URL || 'https://groupwallettweb.onrender.com'}/dashboard.html" class="btn">Ir a GroupWallet</a>
            </div>
        `;
        return templateBase('Recordatorio de Deudas', contenido);
    }
}

module.exports = EmailTemplates;