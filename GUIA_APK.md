# 📱 FoodPlan — Guia para gerar o APK Android

## O que você vai precisar
- Node.js (já tem ✅)
- Android Studio (vamos instalar)
- A pasta `foodplan-app` que você vai baixar

---

## PASSO 1 — Instalar o Android Studio

1. Acesse: https://developer.android.com/studio
2. Baixe e instale normalmente (Next > Next > Finish)
3. Na primeira vez que abrir, deixa ele baixar os SDKs (demora uns 10 min)
4. Quando terminar, feche o Android Studio (por enquanto)

---

## PASSO 2 — Configurar variável ANDROID_HOME

Isso diz ao Capacitor onde está o Android SDK.

**Windows:**
1. Aperta `Win + R`, digita `sysdm.cpl`, Enter
2. Aba "Avançado" → "Variáveis de Ambiente"
3. Em "Variáveis do sistema" clica em "Novo":
   - Nome: `ANDROID_HOME`
   - Valor: `C:\Users\SEU_USUARIO\AppData\Local\Android\Sdk`
     (troca SEU_USUARIO pelo seu nome de usuário do Windows)
4. Ainda em variáveis do sistema, clica em `Path` → "Editar" → "Novo":
   - `%ANDROID_HOME%\tools`
   - `%ANDROID_HOME%\platform-tools`
5. Clica OK em tudo e **fecha e reabre o terminal**

---

## PASSO 3 — Instalar dependências do projeto

Abre o terminal (cmd ou PowerShell), navega até a pasta do projeto e roda:

```bash
cd foodplan-app
npm install
```

Aguarda terminar (baixa o Capacitor, demora 1-2 min).

---

## PASSO 4 — Adicionar a plataforma Android

```bash
npx cap add android
```

Isso cria a pasta `android/` dentro do projeto com todo o projeto Android Studio.

---

## PASSO 5 — Copiar o app para o projeto Android

```bash
npx cap copy android
```

Sempre que modificar o HTML do app, roda esse comando antes de gerar o APK.

---

## PASSO 6 — Abrir no Android Studio e gerar o APK

```bash
npx cap open android
```

O Android Studio abre com o projeto. Aí:

1. Aguarda ele "indexar" o projeto (barra de progresso embaixo)
2. No menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. Aguarda compilar (1-3 min na primeira vez)
4. Quando terminar aparece uma notificação no canto inferior direito: "APK(s) generated successfully"
5. Clica em **"locate"** para abrir a pasta com o arquivo `.apk`

O arquivo fica em:
```
foodplan-app/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## PASSO 7 — Instalar no celular

**Opção A — cabo USB:**
1. No celular: Configurações → Sobre o telefone → toca 7x em "Número da versão" (ativa modo desenvolvedor)
2. Configurações → Opções do desenvolvedor → ativa "Depuração USB"
3. Conecta o cabo, aceita a permissão no celular
4. No Android Studio: **Run → Run 'app'** — instala direto

**Opção B — arquivo direto:**
1. Copia o `app-debug.apk` para o celular (WhatsApp, email, pendrive, Google Drive)
2. No celular, abre o arquivo
3. Se pedir permissão para "instalar apps desconhecidos", libera
4. Instala normalmente

---

## Atualizar o app depois

Sempre que quiser atualizar com uma nova versão do HTML:

1. Substitui o arquivo `www/index.html` pelo novo
2. Roda no terminal:
```bash
npx cap copy android
```
3. Gera o APK de novo (Passo 6)
4. Instala no celular (Passo 7)

---

## Problemas comuns

**"ANDROID_HOME não encontrado"**
→ Refaz o Passo 2 e reinicia o terminal

**"SDK não encontrado"**
→ No Android Studio: Tools → SDK Manager → instala "Android SDK Platform 34"

**"Gradle sync failed"**
→ No Android Studio: File → Sync Project with Gradle Files

**Celular não aparece no Android Studio**
→ Verifica se a depuração USB está ativa e aceita a permissão no celular

---

## Resumo rápido (depois de instalar o Android Studio)

```bash
cd foodplan-app
npm install
npx cap add android
npx cap copy android
npx cap open android
# no Android Studio: Build → Build APK
```
