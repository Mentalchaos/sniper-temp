import os

EXCLUDE_DIRS = ['node_modules', '.git', 'logs', 'dist', 'build']
EXCLUDE_FILES = ['unificar.py', 'package-lock.json', '.DS_Store', 'contexto_completo.txt']

OUTPUT_FILE = "contexto_completo.txt"

def collect_code():
    if os.path.exists(OUTPUT_FILE):
        try:
            os.remove(OUTPUT_FILE)
            print(f"🗑️  Archivo previo '{OUTPUT_FILE}' eliminado. Iniciando limpio...")
        except Exception as e:
            print(f"⚠️  No se pudo borrar el archivo anterior: {e}")
    
    project_text = ""
    
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        
        for file in files:
            if file not in EXCLUDE_FILES and not file.endswith('.png') and not file.endswith('.jpg'):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        project_text += f"\n\n{'='*50}\n"
                        project_text += f"ARCHIVO: {path}\n"
                        project_text += f"{'='*50}\n\n"
                        project_text += f.read()
                        print(f"📄 Leído: {path}")
                except Exception as e:
                    print(f"❌ No se pudo leer {path}: {e}")
                    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write(project_text)
    
    print(f"\n✅ ¡Listo! Contexto NUEVO generado en {OUTPUT_FILE}")

if __name__ == "__main__":
    collect_code()