from rag.ingest.parse_rst import clean_inline, page_url, parse_rst

SAMPLE = """\
.. _doc_signals:

Using signals
=============

Signals are Godot's version of the *observer* pattern. See :ref:`Nodes <doc_nodes>`
and the :ref:`class_Node` class.

.. note:: Signals are emitted with ``emit()``.

Connecting a signal in code
---------------------------

.. tabs::

  .. code-tab:: gdscript GDScript

    func _ready():
        $Button.pressed.connect(_on_pressed)

.. image:: img/signals.webp
   :alt: A screenshot

Read the `official site <https://godotengine.org>`_ for more.
"""


def parse():
    return parse_rst(
        "godot-docs",
        "tutorials/scripting/signals.rst",
        SAMPLE,
        "https://docs.example.org/en/stable",
    )


def test_title_and_url():
    doc = parse()
    assert doc.title == "Using signals"
    assert doc.url == "https://docs.example.org/en/stable/tutorials/scripting/signals.html"


def test_sections_follow_headings():
    doc = parse()
    assert [s.heading_path for s in doc.sections] == [
        ["Using signals"],
        ["Using signals", "Connecting a signal in code"],
    ]


def test_roles_labels_and_notes_are_cleaned():
    intro = parse().sections[0].text
    assert "observer pattern" in intro
    assert "See Nodes\nand the Node class." in intro
    assert "Note: Signals are emitted with `emit()`." in intro
    assert "doc_signals" not in intro
    assert ":ref:" not in intro


def test_code_is_kept_and_images_dropped():
    body = parse().sections[1].text
    assert "```gdscript" in body
    assert "$Button.pressed.connect(_on_pressed)" in body
    assert "signals.webp" not in body
    assert ":alt:" not in body
    assert "Read the official site for more." in body


def test_code_contents_are_not_mistaken_for_headings():
    raw = "Title\n=====\n\n.. code-block:: text\n\n    Not a heading\n    -------------\n"
    doc = parse_rst("s", "a.rst", raw, "https://x")
    assert len(doc.sections) == 1
    assert "Not a heading\n-------------" in doc.sections[0].text


def test_toctree_only_page_is_skipped():
    raw = "Index\n=====\n\n.. toctree::\n   :maxdepth: 1\n\n   page_one\n   page_two\n"
    doc = parse_rst("s", "index.rst", raw, "https://x")
    assert doc is None


def test_clean_inline_bits():
    assert clean_inline("Press :kbd:`Ctrl + S` to save.") == "Press Ctrl + S to save."
    assert clean_inline("Example::") == "Example:"
    assert clean_inline("Use **bold** and ``code``.") == "Use bold and `code`."


def test_page_url():
    assert page_url("https://d/en/stable/", "index.rst") == "https://d/en/stable/index.html"


def test_content_hash_changes_with_content():
    a = parse_rst("s", "a.rst", "Title\n=====\n\nOne.\n", "https://x")
    b = parse_rst("s", "a.rst", "Title\n=====\n\nTwo.\n", "https://x")
    assert a.content_hash != b.content_hash


def test_markup_wrapped_across_lines_is_cleaned():
    raw = "Title\n=====\n\nUsing signals limits `coupling\n<https://example.org>`_ and see\n:ref:`doc_scripting_first_script`.\n"
    text = parse_rst("s", "a.rst", raw, "https://x").sections[0].text
    assert text == "Using signals limits coupling and see\nscripting first script."


def test_class_reference_noise_is_removed():
    raw = (
        ":github_url: hide\n\nNode\n====\n\n"
        "float get_floor_angle\\ (\\ up_direction\\: Vector2\\ ) :ref:`🔗<class_x>`\n\n----\n\nNext.\n"
    )
    doc = parse_rst("s", "classes/class_node.rst", raw, "https://x")
    assert len(doc.sections) == 1
    assert doc.sections[0].text == "float get_floor_angle(up_direction: Vector2)\n\nNext."
