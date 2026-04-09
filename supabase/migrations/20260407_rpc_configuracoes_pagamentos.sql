create or replace function public.salvar_configuracoes_pix(
    p_chave_pix text,
    p_nome_pix text
)
returns public.configuracoes
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_config public.configuracoes;
begin
    insert into public.configuracoes (id, chave_pix, nome_pix)
    values (1, trim(coalesce(p_chave_pix, '')), trim(coalesce(p_nome_pix, '')))
    on conflict (id) do update
    set chave_pix = excluded.chave_pix,
        nome_pix = excluded.nome_pix
    returning * into v_config;

    return v_config;
end;
$$;

revoke all on function public.salvar_configuracoes_pix(text, text) from public;
grant execute on function public.salvar_configuracoes_pix(text, text) to authenticated;


create or replace function public.processar_pagamento(
    p_cliente_id bigint,
    p_item_ids bigint[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_ids bigint[];
    v_total numeric(12,2);
    v_count integer;
begin
    select array_agg(distinct item_id)
    into v_ids
    from unnest(coalesce(p_item_ids, array[]::bigint[])) as item_id;

    if v_ids is null or array_length(v_ids, 1) is null then
        raise exception 'Nenhum item informado para pagamento';
    end if;

    select coalesce(sum(valor_total), 0), count(*)
    into v_total, v_count
    from public.compras
    where cliente_id = p_cliente_id
      and id = any(v_ids)
      and valor_total > 0
      and coalesce(status, 'pago') = 'pendente';

    if v_count = 0 or v_total <= 0 then
        raise exception 'Nenhum item pendente encontrado para pagamento';
    end if;

    update public.compras
    set status = 'quitado'
    where cliente_id = p_cliente_id
      and id = any(v_ids)
      and valor_total > 0
      and coalesce(status, 'pago') = 'pendente';

    insert into public.compras (cliente_id, descricao, valor_total, status)
    values (p_cliente_id, 'PAGAMENTO EFETUADO', -v_total, 'pagamento');

    return jsonb_build_object(
        'cliente_id', p_cliente_id,
        'valor_pago', v_total,
        'itens_quitados', v_count
    );
end;
$$;

revoke all on function public.processar_pagamento(bigint, bigint[]) from public;
grant execute on function public.processar_pagamento(bigint, bigint[]) to authenticated;
