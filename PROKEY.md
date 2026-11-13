# Plataforma de assinatura do ProKey: código-fonte

Esta é a versão da plataforma de assinatura usada pelo ProKey, baseada no
Documenso (https://github.com/documenso/documenso), software livre
distribuído sob a GNU Affero General Public License, versão 3 (AGPL-3.0).
Este repositório contém o código-fonte correspondente à versão em uso, com as
modificações do ProKey, sob a mesma licença ([LICENSE](LICENSE)).

"Documenso" é marca de seus titulares. Esta versão não é distribuída nem
endossada por eles.

## Versão

| | |
|---|---|
| Base | Documenso `v2.21.1`, commit upstream `503cd1a` |
| Versão em uso | `2.21.1-prokey.5` (modificações 0001 a 0005) |
| Licença | AGPL-3.0, sem alteração; `packages/ee` não foi modificado nem é usado |

O primeiro commit deste repositório é a base sem alterações. Cada
modificação seguinte é um commit próprio, com data, que lista os arquivos
alterados. O resumo está abaixo.

## Modificações do ProKey

| # | Data | O que muda | Ligada por |
|---|---|---|---|
| 0001 | 01/11/2026 | Assinatura sem e-mail cadastrado: o diálogo final não pede e-mail e o certificado registra "Link de assinatura" como acesso | `NEXT_PUBLIC_ALLOW_EMAILLESS_SIGNING=true` |
| 0002 | 04/11/2026 | Idioma da tela de assinatura: `pt-BR` reconhecido a partir de `pt`, e idioma padrão configurável | `NEXT_PUBLIC_DEFAULT_LANGUAGE` |
| 0003 | 12/11/2026 | Verificação pública: bloco de conferência no certificado, SHA-256 do original e página do QR que compara o arquivo no navegador | `NEXT_PRIVATE_SIGNING_VERIFICATION=true` |
| 0004 | 12/11/2026 | Layout do certificado: cabeçalho, ordem do bloco de verificação, datas no fuso configurado, bordas e rodapé | `NEXT_PRIVATE_SIGNING_VERIFICATION=true` |
| 0005 | 12/11/2026 | Microtexto do fundo do certificado como imagem, para o PDF ficar leve | `NEXT_PRIVATE_SIGNING_VERIFICATION=true` |

Sem as variáveis, o comportamento é o do upstream.

### Arquivos modificados

Alterados (modificados pelo ProKey, conforme as datas acima):

- `apps/remix/app/components/general/document-signing/document-signing-complete-dialog.tsx` (0001)
- `apps/remix/app/components/general/envelope-signing/envelope-signing-complete-dialog.tsx` (0001)
- `apps/remix/app/routes/_internal+/[__htmltopdf]+/certificate.tsx` (0001)
- `apps/remix/app/routes/_share+/share.$slug.tsx` (0003)
- `packages/lib/jobs/definitions/internal/seal-document.handler.ts` (0003)
- `packages/lib/server-only/document/complete-document-with-token.ts` (0001)
- `packages/lib/server-only/pdf/generate-certificate-pdf.ts` (0001, 0003, 0004)
- `packages/lib/server-only/pdf/render-certificate.ts` (0003, 0004, 0005)
- `packages/lib/translations/en/web.po` (0001, 0003, 0004)
- `packages/lib/translations/pt-BR/web.po` (0001, 0003, 0004)
- `packages/lib/utils/i18n.ts` (0002)

Novos (criados pelo ProKey):

- `apps/remix/app/components/general/document/document-verification-panel.tsx` (0003)
- `packages/lib/server-only/document/get-document-verification-by-access-token.ts` (0003)
- `packages/lib/utils/emailless-signing.ts` e `emailless-signing.test.ts` (0001)
- `packages/lib/utils/locale-match.ts` e `locale-match.test.ts` (0002)
- `packages/lib/utils/signing-verification.ts` e `signing-verification.test.ts` (0003, 0004)

## Build

Requisitos: Node e npm nas versões do `package.json`, e Docker.

```bash
npm ci
(cd packages/lib && npx vitest run utils/emailless-signing.test.ts utils/locale-match.test.ts utils/signing-verification.test.ts)
docker build -f docker/Dockerfile -t plataforma-assinatura:2.21.1-prokey.5 .
```

A imagem em uso é gerada deste código, sem outras alterações, com o
`docker/Dockerfile` do projeto.
