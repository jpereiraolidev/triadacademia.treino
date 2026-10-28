-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "membershipId" TEXT,
    "valor" DECIMAL(10,2) NOT NULL,
    "valorRecebido" DECIMAL(10,2) NOT NULL,
    "troco" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "forma" VARCHAR(20) NOT NULL,
    "vencimentoAnterior" TIMESTAMP(3),
    "novoVencimento" TIMESTAMP(3),
    "origem" VARCHAR(20) NOT NULL DEFAULT 'FINANCEIRO',
    "observacao" TEXT,
    "registradoPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "categoria" VARCHAR(60),
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "valorCompra" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valorVenda" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "produtoNome" VARCHAR(120) NOT NULL,
    "categoria" VARCHAR(60),
    "quantidade" INTEGER NOT NULL,
    "valorUnitario" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "valorRecebido" DECIMAL(10,2) NOT NULL,
    "valorDevolvido" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "forma" VARCHAR(20) NOT NULL,
    "registeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nomeAcademia" VARCHAR(120) NOT NULL DEFAULT 'TRIAD Academia',
    "subtituloSistema" VARCHAR(120) NOT NULL DEFAULT 'Academia',
    "logoAcademia" VARCHAR(2000),
    "corPrincipal" VARCHAR(20) NOT NULL DEFAULT '#2563eb',
    "valorMensalidadePadrao" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "diasTolerancia" INTEGER NOT NULL DEFAULT 0,
    "bloquearVencidos" VARCHAR(3) NOT NULL DEFAULT 'sim',
    "mensagemBomTreino" VARCHAR(500) NOT NULL DEFAULT 'Acesso liberado. Bom treino!',
    "mensagemAcessoNegado" VARCHAR(500) NOT NULL DEFAULT 'Acesso bloqueado. Procure a recepção.',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_studentId_createdAt_idx" ON "Payment"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_membershipId_idx" ON "Payment"("membershipId");

-- CreateIndex
CREATE INDEX "Payment_registradoPor_idx" ON "Payment"("registradoPor");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_origem_createdAt_idx" ON "Payment"("origem", "createdAt");

-- CreateIndex
CREATE INDEX "Product_nome_idx" ON "Product"("nome");

-- CreateIndex
CREATE INDEX "Product_categoria_idx" ON "Product"("categoria");

-- CreateIndex
CREATE INDEX "Product_active_idx" ON "Product"("active");

-- CreateIndex
CREATE INDEX "Sale_produtoId_idx" ON "Sale"("produtoId");

-- CreateIndex
CREATE INDEX "Sale_registeredBy_idx" ON "Sale"("registeredBy");

-- CreateIndex
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registradoPor_fkey" FOREIGN KEY ("registradoPor") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_registeredBy_fkey" FOREIGN KEY ("registeredBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
