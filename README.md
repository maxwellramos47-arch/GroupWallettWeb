# GroupWallet - Sistema de Gestión de Finanzas Compartidas (SaaS)

## 📝 Descripción del Proyecto
GroupWallet es una aplicación web transaccional concebida bajo el modelo de Software as a Service (SaaS). Está diseñada para optimizar y simplificar la administración de gastos colectivos, permitiendo la creación de grupos independientes, el registro parametrizado de transacciones monetarias y la división equitativa de saldos entre múltiples usuarios en tiempo real. 

El sistema implementa una arquitectura desacoplada que asegura consistencia, escalabilidad y una separación estricta de responsabilidades entre el cliente y el servidor.

## 🚀 Arquitectura Tecnológica

### Capa de Presentación (Frontend)
* **HTML5 Semántico:** Estructuración jerárquica y accesible mediante el uso de contenedores estructurales (`<header>`, `<nav>`, `<main>`, `<section>`, `<article>`) que garantizan el cumplimiento de pautas de accesibilidad web (WCAG).
* **CSS3 Avanzado:** Diseño adaptativo e integral (Responsive Design) implementado mediante CSS Grid y Flexbox nativo, abstrayéndose del uso de frameworks pesados de terceros para optimizar el rendimiento y los tiempos de carga (*First Contentful Paint*).
* **JavaScript Vanilla:** Motor lógico del lado del cliente enfocado en la manipulación dinámica del DOM, control de eventos asíncronos y gestión del estado financiero local a través de colecciones mutables en memoria.

### Capa de Lógica de Negocio (Backend)
* **Node.js & Express:** Servidor HTTP encargado del enrutamiento y exposición de una API REST para el intercambio de datos estructurados en formato JSON.
* **Seguridad y Autenticación:** Protección de endpoints mediante el estándar JSON Web Tokens (JWT). Gestión de sesiones apátridas e interceptor global de Fetch en el cliente para el control estricto de expiración de credenciales.
* **Programación de Tareas (`node-cron`):** Motor de automatización en segundo plano para procesos periódicos de auditoría, control de cuotas y expiración de suscripciones premium.

### Capa de Persistencia (Base de Datos)
* **PostgreSQL:** Sistema de gestión de base de datos relacional (RDBMS) encargado de garantizar la integridad referencial, consistencia transaccional y normalización del esquema de datos.

## 📂 Estructura del Directorio

```text
├── .env                  # Variables de entorno y secretos criptográficos (Excluido)
├── .gitignore            # Manifiesto de exclusión de archivos para Git
├── LICENSE               # Licencia de distribución MIT
├── README.md             # Documentación técnica principal del repositorio
├── ajustes.html          # Interfaz de gestión de perfil y métodos de pago
├── ajustes.js            # Lógica y consumo de API para el perfil de usuario
├── app.js                # Controlador principal del frontend y gestión de estados
├── dashboard.html        # Panel de control central del usuario (Módulos y Analíticas)
├── grupos.html           # Interfaz de administración y creación de grupos
├── grupos.js             # Lógica de procesamiento de membresías y enlaces de invitación
├── historial.html        # Consulta de registros transaccionales archivados
├── historial.js          # Lógica de renderizado histórico y exportación de datos
├── index.html            # Portal de acceso e inicio de sesión (Autenticación)
├── login.js              # Gestión de peticiones de login y almacenamiento de tokens
├── schema.sql            # Script de definición de estructuras de la base de datos relacional
├── server.js             # Punto de entrada del servidor backend (Node.js)
└── styles.css            # Hoja de estilos global y variables de diseño adaptativo
