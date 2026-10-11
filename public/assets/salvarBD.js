/* ============================================================
   TRIAD ACADEMIA — salvarBD.js
   Camada única de acesso à API.
   Toda comunicação com o servidor passa por aqui.
============================================================ */

/* ============================================================
   API (axios instance única)
============================================================ */
const API = axios.create({
  baseURL: window.location.origin + '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

/* ============================================================
   AUTENTICAÇÃO
============================================================ */
const BD = {

  /* ---------- AUTH ---------- */
  async login(email, senha) {
    const { data } = await API.post('/login', { email, senha });
    return data.usuario;
  },

  async cadastro({ nome, email, telefone, senha }) {
    const { data } = await API.post('/cadastro', {
      nome, email, telefone, senha, perfil: 'aluno'
    });
    return data.usuario;
  },

  async recuperarSenha(email) {
    const { data } = await API.post('/recuperar-senha', { email });
    return data;
  },

  async primeiroAcesso(email, senha, codigo) {
    const { data } = await API.post('/primeiro-acesso', { email, senha, codigo });
    return data.usuario;
  },

  /* ---------- USUÁRIOS ---------- */
  async getUsuario(id) {
    const { data } = await API.get('/usuarios/' + id);
    return data.usuario;
  },

  async getUsuarios() {
    const { data } = await API.get('/usuarios');
    return data.usuarios || [];
  },

  async atualizarUsuario(id, campos) {
    const { data } = await API.patch('/usuarios/' + id, campos);
    return data.usuario;
  },

  async salvarPerfilCompleto(id, { dadosPessoais, dadosFisicos, objetivos }) {
    const { data } = await API.put('/usuarios/' + id + '/perfil-completo', {
      dadosPessoais, dadosFisicos, objetivos
    });
    return data.usuario;
  },

  async getStats(id) {
    const { data } = await API.get('/usuarios/' + id + '/stats');
    return data.stats;
  },

  /* ---------- TREINOS ---------- */
  async getTreinoAtivo(id) {
    const { data } = await API.get('/usuarios/' + id + '/treino-ativo');
    return data.treino;
  },

  async getTreinoHoje(id) {
    const { data } = await API.get('/usuarios/' + id + '/treino-hoje');
    return data;
  },

  async getHistoricoTreinos(id) {
    const { data } = await API.get('/usuarios/' + id + '/historico-treinos');
    return data.treinos || [];
  },

  async getTreino(treinoId) {
    const { data } = await API.get('/treinos/' + treinoId);
    return data.treino;
  },

  async getSessao(treinoId, sessaoId) {
    const { data } = await API.get(`/treinos/${treinoId}/sessao/${sessaoId}`);
    return data;
  },

  async gerarTreino(usuarioId, motivo = 'Geração manual') {
    const { data } = await API.post('/usuarios/' + usuarioId + '/gerar-treino', { motivo });
    return data.treino;
  },

  /* ---------- CHECK-INS ---------- */
  async fazerCheckin({ usuarioId, tipo, sessaoId, treinoId, humor, duracao }) {
    const { data } = await API.post('/checkin', {
      usuarioId, tipo, sessaoId, treinoId, humor, duracao
    });
    return data.checkin;
  },

  async getCheckins(usuarioId) {
    const { data } = await API.get('/checkins/' + usuarioId);
    return data.checkins || [];
  },

  /* ---------- COMUNICADOS ---------- */
  async getComunicados() {
    const { data } = await API.get('/comunicados');
    return data.comunicados || [];
  },

  async criarComunicado({ titulo, mensagem, autor }) {
    const { data } = await API.post('/comunicados', { titulo, mensagem, autor });
    return data.comunicado;
  },

  /* ---------- HISTÓRICO ---------- */
  async getHistorico(limite = 50) {
    const { data } = await API.get('/historico?limite=' + limite);
    return data.historico || [];
  },

  /* ---------- ACADEMIA ---------- */
  async getAcademia() {
    const { data } = await API.get('/academia');
    return data.academia;
  },

  async health() {
    const { data } = await API.get('/health');
    return data;
  }
};

window.BD = BD;
window.API = API;