import os

EXCLUDE_DIRS = ['node_modules', '.git', 'logs']
EXCLUDE_FILES = ['unificar.py', 'package-lock.json', '.DS_Store']

def collect_code():
    project_text = ""
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        
        for file in files:
            if file not in EXCLUDE_FILES:
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        project_text += f"\n\n{'='*50}\n"
                        project_text += f"ARCHIVO: {path}\n"
                        project_text += f"{'='*50}\n\n"
                        project_text += f.read()
                except Exception as e:
                    print(f"No se pudo leer {path}: {e}")
                    
    with open("contexto_completo.txt", "w", encoding="utf-8") as out:
        out.write(project_text)
    print("✅ Contexto generado en contexto_completo.txt")

if __name__ == "__main__":
    collect_code()