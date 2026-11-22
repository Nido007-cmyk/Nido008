/*
 * ventanax.c - cliente X minimo para los cobros de ventana (registro 7:
 * instancia unica). Un solo fichero, sin dependencias mas alla de libX11.
 *
 * Compilar:
 *   gcc -O2 -Wall -Wextra -o ventanax ventanax.c -lX11
 *
 * Uso:
 *   ventanax list          enumera las ventanas de nivel superior del root
 *                          y lee el foco de entrada (XGetInputFocus).
 *   ventanax close <id>    envia WM_DELETE_WINDOW a la ventana <id>
 *                          (decimal o 0x...). Es el gesto que haria un
 *                          gestor de ventanas; bajo un Xvfb desnudo no hay
 *                          gestor, asi que el cliente lo replica enviando
 *                          el ClientMessage WM_PROTOCOLS/WM_DELETE_WINDOW
 *                          a la propia ventana. No mata ningun proceso:
 *                          la ventana decide como cerrarse.
 *   ventanax testwin       ventana de prueba para el gesto: anuncia
 *                          WM_DELETE_WINDOW en WM_PROTOCOLS, toma el foco,
 *                          y al recibir el mensaje se destruye a si misma
 *                          y sale con codigo 42 (distinguible de un kill:
 *                          SIGTERM daria 143 y SIGKILL 137).
 */

#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static Display *abrir(void)
{
    Display *d = XOpenDisplay(NULL);
    if (!d) {
        fprintf(stderr, "ventanax: no puedo abrir el display (DISPLAY=%s)\n",
                getenv("DISPLAY") ? getenv("DISPLAY") : "(sin definir)");
        exit(2);
    }
    return d;
}

static char *nombre_ventana(Display *d, Window w)
{
    /* Primero _NET_WM_NAME (UTF8), despues el nombre clasico. */
    Atom tipo;
    int formato;
    unsigned long n = 0, resto = 0;
    unsigned char *datos = NULL;
    Atom net_wm_name = XInternAtom(d, "_NET_WM_NAME", False);
    Atom utf8 = XInternAtom(d, "UTF8_STRING", False);
    if (XGetWindowProperty(d, w, net_wm_name, 0, 1024, False, utf8,
                           &tipo, &formato, &n, &resto, &datos) == Success
        && datos && n > 0) {
        char *copia = malloc(n + 1);
        memcpy(copia, datos, n);
        copia[n] = '\0';
        XFree(datos);
        return copia;
    }
    if (datos)
        XFree(datos);
    char *nombre = NULL;
    if (XFetchName(d, w, &nombre) && nombre)
        return nombre;
    return "(sin nombre)";
}

static int modo_list(void)
{
    Display *d = abrir();
    Window root = DefaultRootWindow(d);
    Window foco;
    int revert = 0;
    XGetInputFocus(d, &foco, &revert);
    printf("root=0x%lx foco=0x%lx revert=%d\n",
           (unsigned long)root, (unsigned long)foco, revert);

    Window raiz_dev, padre_dev, *hijas = NULL;
    unsigned int n_hijas = 0;
    if (!XQueryTree(d, root, &raiz_dev, &padre_dev, &hijas, &n_hijas)) {
        fprintf(stderr, "ventanax: XQueryTree fallo\n");
        XCloseDisplay(d);
        return 2;
    }
    printf("ventanas_nivel_superior=%u\n", n_hijas);
    for (unsigned int i = 0; i < n_hijas; i++) {
        XWindowAttributes at;
        XGetWindowAttributes(d, hijas[i], &at);
        char *nombre = nombre_ventana(d, hijas[i]);
        printf("win=0x%lx id=%lu nombre=\"%s\" x=%d y=%d ancho=%d alto=%d "
               "map_state=%d override=%d\n",
               (unsigned long)hijas[i], (unsigned long)hijas[i], nombre,
               at.x, at.y, at.width, at.height, at.map_state,
               at.override_redirect);
        if (nombre != NULL && strcmp(nombre, "(sin nombre)") != 0)
            XFree(nombre);
    }
    if (hijas)
        XFree(hijas);
    XCloseDisplay(d);
    return 0;
}

static int modo_close(const char *arg)
{
    Display *d = abrir();
    Window w = (Window)strtoul(arg, NULL, 0);
    Atom wm_protocols = XInternAtom(d, "WM_PROTOCOLS", False);
    Atom wm_delete = XInternAtom(d, "WM_DELETE_WINDOW", False);

    XEvent ev;
    memset(&ev, 0, sizeof(ev));
    ev.xclient.type = ClientMessage;
    ev.xclient.window = w;
    ev.xclient.message_type = wm_protocols;
    ev.xclient.format = 32;
    ev.xclient.data.l[0] = (long)wm_delete;
    ev.xclient.data.l[1] = CurrentTime;
    /* NoEventMask: el mensaje va al cliente que creo la ventana, que es
     * como un gestor entrega WM_DELETE_WINDOW. */
    if (!XSendEvent(d, w, False, NoEventMask, &ev)) {
        fprintf(stderr, "ventanax: XSendEvent fallo para 0x%lx\n",
                (unsigned long)w);
        XCloseDisplay(d);
        return 2;
    }
    XFlush(d);
    printf("enviado WM_DELETE_WINDOW a win=0x%lx (sin matar ningun proceso)\n",
           (unsigned long)w);
    XCloseDisplay(d);
    return 0;
}

static int modo_testwin(void)
{
    Display *d = abrir();
    Window root = DefaultRootWindow(d);
    Window w = XCreateSimpleWindow(d, root, 10, 10, 400, 200, 1,
                                   BlackPixel(d, DefaultScreen(d)),
                                   WhitePixel(d, DefaultScreen(d)));
    XStoreName(d, w, "VENTANAX-PRUEBA");
    Atom wm_delete = XInternAtom(d, "WM_DELETE_WINDOW", False);
    XSetWMProtocols(d, w, &wm_delete, 1);
    XSelectInput(d, w, StructureNotifyMask | ExposureMask);
    XMapWindow(d, w);
    XSetInputFocus(d, w, RevertToParent, CurrentTime);
    XFlush(d);
    printf("TESTWIN lista win=0x%lx id=%lu pid=%ld\n",
           (unsigned long)w, (unsigned long)w, (long)getpid());
    fflush(stdout);

    for (;;) {
        XEvent ev;
        XNextEvent(d, &ev);
        if (ev.type == ClientMessage &&
            (Atom)ev.xclient.data.l[0] == wm_delete) {
            printf("TESTWIN recibi WM_DELETE_WINDOW: me destruyo yo misma "
                   "y salgo con codigo 42\n");
            fflush(stdout);
            XDestroyWindow(d, w);
            XCloseDisplay(d);
            return 42;
        }
        if (ev.type == DestroyNotify) {
            printf("TESTWIN recibi DestroyNotify ajeno: salgo con 43\n");
            fflush(stdout);
            XCloseDisplay(d);
            return 43;
        }
    }
}

int main(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "list") == 0)
        return modo_list();
    if (argc >= 3 && strcmp(argv[1], "close") == 0)
        return modo_close(argv[2]);
    if (argc >= 2 && strcmp(argv[1], "testwin") == 0)
        return modo_testwin();
    fprintf(stderr, "uso: %s list | close <id> | testwin\n", argv[0]);
    return 2;
}
