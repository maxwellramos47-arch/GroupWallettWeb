const express = require('express');
const router = express.Router();
const GastoBLL = require('../BLL/gasto.bll');
const { verificarToken } = require('../Middleware/auth.middleware');
const { z } = require('zod');

// --- Esquemas de Validación Zod ---
const crearGastoSchema = z.object({
    id_grupo: z.union([z.number(), z.string()]).transform(v => parseInt(v, 10)),
    descripcion: z.string().min(1, "La descripción es obligatoria").max(255),
    categoria: z.string().optional().default("General"),
    monto: z.union([z.number(), z.string()]).transform(v => parseFloat(v)).refine(v => v > 0, "El monto debe ser mayor a 0"),
    pagador: z.union([z.number(), z.string()]).transform(v => String(v)),
    participantes: z.array(z.union([z.number(), z.string()])).min(1, "Debes seleccionar al menos un participante"),
    fecha: z.string().optional().nullable(),
    comprobante_url: z.string().url("URL de comprobante inválida").optional().nullable()
});

const editarGastoSchema = z.object({
    descripcion: z.string().min(1, "La descripción es obligatoria").max(255),
    categoria: z.string().optional().default("General"),
    monto: z.union([z.number(), z.string()]).transform(v => parseFloat(v)).refine(v => v > 0, "El monto debe ser mayor a 0")
});

router.get('/', verificarToken, async (req, res) => {
    try {
        res.json(await GastoBLL.obtenerGastos(req.usuarioLogueado.id_usuario));
    } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
});

router.post('/', verificarToken, async (req, res) => {
    try {
        const validacion = crearGastoSchema.safeParse(req.body);
        if (!validacion.success) return res.status(400).json({ error: validacion.error.errors[0].message });
        
        const { id_grupo, descripcion, categoria, monto, pagador, participantes, fecha, comprobante_url } = validacion.data;
        const data = await GastoBLL.crearGasto(id_grupo, descripcion, categoria || 'General', monto, pagador, participantes, fecha, comprobante_url, req.usuarioLogueado.id_usuario);
        res.status(201).json({ message: 'Gasto guardado exitosamente en PostgreSQL.', data });
    } catch (error) {
        res.status(error.message.includes('denegado') || error.message.includes('Faltan') ? 400 : 500).json({ error: error.message || 'Error al procesar la transacción' });
    }
});

router.delete('/:id', verificarToken, async (req, res) => {
    try {
        await GastoBLL.eliminarGasto(req.params.id, req.usuarioLogueado.id_usuario);
        
        // Emitir evento en tiempo real a todos los clientes conectados
        req.io.emit('gasto_eliminado', { id_transaccion: req.params.id });
        
        res.json({ message: 'Gasto eliminado exitosamente.' });
    } catch (error) {
        res.status(error.message.includes('encontrado') ? 404 : 403).json({ error: error.message });
    }
});

router.put('/:id', verificarToken, async (req, res) => {
    try {
        const validacion = editarGastoSchema.safeParse(req.body);
        if (!validacion.success) return res.status(400).json({ error: validacion.error.errors[0].message });
        
        const { descripcion, categoria, monto } = validacion.data;
        await GastoBLL.editarGasto(req.params.id, descripcion, categoria || 'General', monto, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Gasto actualizado exitosamente.' });
    } catch (error) { res.status(403).json({ error: error.message }); }
});

router.put('/:id/comprobante', verificarToken, async (req, res) => {
    try {
        const { comprobante_url } = req.body;
        await GastoBLL.actualizarComprobante(req.params.id, comprobante_url, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Comprobante actualizado exitosamente.' });
    } catch (error) { res.status(403).json({ error: error.message }); }
});

module.exports = router;