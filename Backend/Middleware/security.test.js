const { generarFirmaHMAC } = require('./security.util');

// Entorno de prueba para HMAC
process.env.HMAC_SECRET = 'test_hmac_secret';

describe('Pruebas Unitarias - Módulo de Seguridad', () => {
    test('generarFirmaHMAC debe generar firmas idénticas para los mismos datos', () => {
        const datos = '1-50.00-Cena compartida';
        const firma1 = generarFirmaHMAC(datos);
        const firma2 = generarFirmaHMAC(datos);
        
        expect(firma1).toBe(firma2); // Comprueba el determinismo del algoritmo
    });

    test('generarFirmaHMAC debe alterar toda la firma si cambia 1 solo caracter (Efecto avalancha)', () => {
        const firmaOriginal = generarFirmaHMAC('1-50.00-Cena compartida');
        const firmaAlterada = generarFirmaHMAC('1-50.01-Cena compartida'); // Simulamos que un atacante alteró 1 centavo
        
        expect(firmaOriginal).not.toBe(firmaAlterada);
    });
});