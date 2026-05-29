const GastoBLL = require('./gasto.bll');
const GastoDAL = require('../DAL/gasto.dal');
const GrupoDAL = require('../DAL/grupo.dal');
const UsuarioDAL = require('../DAL/usuario.dal');

// Hacemos un Mock de la capa de datos para aislar la lógica matemática sin tocar PostgreSQL
jest.mock('../DAL/gasto.dal');
jest.mock('../DAL/grupo.dal');
jest.mock('../DAL/usuario.dal');

describe('Pruebas Unitarias - Módulo de Gastos (Comisiones)', () => {
    beforeEach(() => {
        jest.clearAllMocks(); // Limpiamos el historial de pruebas anteriores
    });

    test('El cálculo de la comisión In-App (0.89%) debe ser matemáticamente exacto', async () => {
        // 1. Preparamos el escenario simulado
        GastoDAL.checkUserInGroupTransaccion.mockResolvedValue(true);
        
        // Simulamos un gasto de $10,000.00 que se dividió entre 4 participantes
        GastoDAL.getMontoCuota.mockResolvedValue({
            monto: 10000,
            id_receptor: 2,
            total_participantes: 4
        });

        // Simulamos que Prisma archivó correctamente el gasto
        GastoDAL.registerInAppPaymentAndArchive.mockResolvedValue(true);

        // 2. Ejecutamos la función de la capa de Negocio (BLL)
        const resultado = await GastoBLL.pagarCuotaInApp(1, 1, 1);

        // 3. Aserciones (Comprobaciones Matemáticas)
        // Cuota Base: 10,000 / 4 = 2,500
        expect(resultado.montoBase).toBe(2500);
        // Comisión del 0.89%: 2,500 * 0.0089 = 22.25
        expect(resultado.comision).toBe(22.25);
        // Total a Debitar: 2,500 + 22.25 = 2,522.25
        expect(resultado.total).toBe(2522.25);
    });
});