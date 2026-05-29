const GrupoBLL = require('./grupo.bll');
const GrupoDAL = require('../DAL/grupo.dal');

// Hacemos un Mock de la capa de datos
jest.mock('../DAL/grupo.dal');

describe('Pruebas Unitarias - Algoritmo de Liquidación de Deudas', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Debe simplificar deudas en cadena (Ej: A le debe a B, y B le debe a C)', async () => {
        GrupoDAL.getMemberRole.mockResolvedValue('Miembro');
        
        // Escenario: Juan le debe 50 a María, y María le debe 50 a Pedro.
        GrupoDAL.getPendingDebts.mockResolvedValue([
            { id_acreedor: 2, acreedor_nombre: 'María', id_deudor: 1, deudor_nombre: 'Juan', monto: 50 },
            { id_acreedor: 3, acreedor_nombre: 'Pedro', id_deudor: 2, deudor_nombre: 'María', monto: 50 }
        ]);

        const transferencias = await GrupoBLL.liquidarDeudas(1, 1);

        // El algoritmo inteligente debe deducir que María queda en cero, y Juan le paga directo a Pedro.
        expect(transferencias.length).toBe(1);
        expect(transferencias[0]).toEqual({
            deudor: 'Juan',
            acreedor: 'Pedro',
            monto: 50
        });
    });

    test('Debe resolver balances complejos con múltiples cruces y decimales', async () => {
        GrupoDAL.getMemberRole.mockResolvedValue('Administrador');
        
        // Escenario: 
        // - "A" le debe 20 a "B"
        // - "A" le debe 20 a "C"
        // - "B" le debe 10 a "C"
        GrupoDAL.getPendingDebts.mockResolvedValue([
            { id_acreedor: 2, acreedor_nombre: 'B', id_deudor: 1, deudor_nombre: 'A', monto: 20 },
            { id_acreedor: 3, acreedor_nombre: 'C', id_deudor: 1, deudor_nombre: 'A', monto: 20 },
            { id_acreedor: 3, acreedor_nombre: 'C', id_deudor: 2, deudor_nombre: 'B', monto: 10 }
        ]);

        const transferencias = await GrupoBLL.liquidarDeudas(1, 1);

        // Resultado esperado: "A" paga todo su déficit (40) directo a los que tienen saldo positivo.
        expect(transferencias.length).toBe(2);
        expect(transferencias).toContainEqual({ deudor: 'A', acreedor: 'C', monto: 30 }); // C recibe sus 30 netos
        expect(transferencias).toContainEqual({ deudor: 'A', acreedor: 'B', monto: 10 }); // B recibe 10 netos
    });
});