# -*- coding: utf-8 -*-
"""Mobile Ninja — сервер: раздаёт файлы игры (HTTP :8000) и сводит игроков
в комнаты по коду (WebSocket :8001). Внутри комнаты просто пересылает
сообщения между хостом и гостем — всю игру считает хост."""
import asyncio
import functools
import http.server
import json
import os
import random
import socketserver
import threading

import websockets

HTTP_PORT = 8000
WS_PORT = 8001
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # без похожих букв/цифр

rooms = {}  # код -> {"host": ws, "guest": ws | None}


def new_code():
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=4))
        if code not in rooms:
            return code


async def send(ws, obj):
    try:
        await ws.send(json.dumps(obj))
    except Exception:
        pass


async def handler(ws):
    my_code = None
    my_role = None
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            t = msg.get("t")

            if t == "create" and my_code is None:
                my_code = new_code()
                my_role = "host"
                rooms[my_code] = {"host": ws, "guest": None}
                await send(ws, {"t": "created", "code": my_code})

            elif t == "join" and my_code is None:
                code = str(msg.get("code", "")).strip().upper()
                room = rooms.get(code)
                if room is None or room["guest"] is not None:
                    await send(ws, {"t": "error", "msg": "Комната не найдена или занята"})
                else:
                    my_code, my_role = code, "guest"
                    room["guest"] = ws
                    await send(room["host"], {"t": "start", "role": "host"})
                    await send(ws, {"t": "start", "role": "guest"})

            else:
                # игровое сообщение — пересылаем второму игроку как есть
                room = rooms.get(my_code)
                if room:
                    peer = room["guest"] if my_role == "host" else room["host"]
                    if peer is not None:
                        try:
                            await peer.send(raw)
                        except Exception:
                            pass
    finally:
        room = rooms.pop(my_code, None) if my_code else None
        if room:
            peer = room["guest"] if my_role == "host" else room["host"]
            if peer is not None:
                await send(peer, {"t": "peer_left"})


class HttpHandler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 с keep-alive — обязательно для туннелей (localhost.run, serveo)
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # не засоряем консоль


def run_http():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", HTTP_PORT), HttpHandler) as httpd:
        httpd.serve_forever()


async def main():
    threading.Thread(target=run_http, daemon=True).start()
    async with websockets.serve(handler, "0.0.0.0", WS_PORT):
        print(f"HTTP  : http://0.0.0.0:{HTTP_PORT}")
        print(f"WS    : ws://0.0.0.0:{WS_PORT}")
        print("Сервер Mobile Ninja запущен. Не закрывайте окно.")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
