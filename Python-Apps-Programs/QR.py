import qrcode

data = input()
qr = qrcode.make(data)
qr.save("qrcode.png")
print("QR code saved as qrcode.png")
